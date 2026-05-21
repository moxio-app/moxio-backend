import cors from "@fastify/cors";
import dotenv from "dotenv";
import type { FastifyReply } from "fastify";
import Fastify from "fastify";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { z } from "zod";
import { executeAction, isActionError, listActions } from "./actions.js";
import { createAccountManagerChatResponse, type AiChatRequestBody } from "./ai-chat.js";
import { handleChatTurn } from "./chat.js";
import { getBootstrap, store } from "./store.js";
import type { Integration } from "./types.js";

dotenv.config();

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";
const appUrl = process.env.APP_URL || `http://localhost:${port}`;
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
const fallbackFrontendOrigin = new URL(frontendUrl).origin;
const zernioApiBase = "https://zernio.com/api/v1";

const app = Fastify({
  logger: true,
});

class HttpError extends Error {
  constructor(
    message: string,
    public statusCode = 500,
  ) {
    super(message);
  }
}

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new HttpError(`${name} is required to start integration OAuth.`, 500);
  }
  return value;
};

const providerPlatform: Partial<Record<Integration["provider"], string>> = {
  Facebook: "facebook",
  Instagram: "instagram",
  LinkedIn: "linkedin",
  Twitter: "twitter",
  TikTok: "tiktok",
  Bluesky: "bluesky",
  Threads: "threads",
  Mailchimp: "mailchimp",
  HubSpot: "hubspot",
  WordPress: "wordpress",
  GA4: "ga4",
};

const findIntegration = (provider: string) =>
  store.integrations.find((integration) => integration.provider.toLowerCase() === provider.toLowerCase());

const readWebOrigin = (value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
};

const integrationOAuthPopupHtml = (payload: unknown, fallbackUrl: string, targetOrigin: string) => {
  const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  const safeFallbackUrl = JSON.stringify(fallbackUrl);
  const safeTargetOrigin = JSON.stringify(targetOrigin);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Integration connected</title>
  </head>
  <body>
    <script>
      const payload = ${safePayload};
      const fallbackUrl = ${safeFallbackUrl};
      const targetOrigin = ${safeTargetOrigin};

      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, targetOrigin);
        window.close();
      } else {
        window.location.href = fallbackUrl;
      }
    </script>
    <p>You can close this window.</p>
  </body>
</html>`;
};

const finishIntegrationOAuth = (
  reply: FastifyReply,
  popup: boolean,
  redirectUrl: URL,
  payload: { type: "moxio:integration-oauth"; ok: boolean; provider: string; error?: string },
  targetOrigin = fallbackFrontendOrigin,
) => {
  if (popup) {
    return reply.type("text/html").send(integrationOAuthPopupHtml(payload, redirectUrl.toString(), targetOrigin));
  }

  return reply.redirect(redirectUrl.toString());
};

interface ZernioProfile {
  _id?: string;
  id?: string;
  name?: string;
  isDefault?: boolean;
}

type FetchOptions = Parameters<typeof fetch>[1];

const zernioFetch = async <T>(path: string, options: FetchOptions = {}) => {
  const headers = new Headers(options?.headers);
  headers.set("Authorization", `Bearer ${requireEnv("ZERNIO_API_KEY")}`);
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${zernioApiBase}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new HttpError(text || `Zernio request failed with ${response.status}.`, response.status >= 500 ? 502 : response.status);
  }

  return (await response.json()) as T;
};

const readZernioProfileId = (profile?: ZernioProfile) => profile?._id ?? profile?.id;

const getZernioProfileId = async () => {
  if (process.env.ZERNIO_PROFILE_ID) return process.env.ZERNIO_PROFILE_ID;

  const profileName = process.env.ZERNIO_PROFILE_NAME || "Moxio Integrations";
  const listed = await zernioFetch<{ profiles?: ZernioProfile[]; data?: ZernioProfile[] }>(
    "/profiles?includeOverLimit=true",
  );
  const profiles = listed.profiles ?? listed.data ?? [];
  const existingProfile =
    profiles.find((profile) => profile.name === profileName) ?? profiles.find((profile) => profile.isDefault);
  const existingProfileId = readZernioProfileId(existingProfile);
  if (existingProfileId) return existingProfileId;

  const created = await zernioFetch<{ profile?: ZernioProfile; data?: ZernioProfile }>("/profiles", {
    method: "POST",
    body: JSON.stringify({ name: profileName }),
  });
  const createdProfileId = readZernioProfileId(created.profile ?? created.data);
  if (!createdProfileId) {
    throw new HttpError("Zernio did not return a profile id.", 502);
  }

  return createdProfileId;
};

const sendWebResponse = (reply: FastifyReply, response: Response) => {
  response.headers.forEach((value, key) => {
    reply.header(key, value);
  });

  reply.code(response.status);

  if (!response.body) {
    return reply.send();
  }

  return reply.send(Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>));
};

await app.register(cors, {
  origin: true,
});

app.get("/health", async () => ({
  ok: true,
  service: "moxio-backend",
  timestamp: new Date().toISOString(),
}));

app.get("/api/bootstrap", async () => getBootstrap());

app.get("/api/actions", async () => ({ actions: listActions() }));

app.post("/api/integrations/:provider/oauth/start", async (request, reply) => {
  const { provider } = z.object({ provider: z.string().min(1) }).parse(request.params);
  const startQuery = z.object({ popup: z.string().optional() }).parse(request.query ?? {});
  const startBody = z.object({ openerOrigin: z.string().optional() }).parse(request.body ?? {});
  const integration = findIntegration(provider);

  if (!integration) {
    return reply.code(404).send({ error: "Integration provider not found." });
  }

  const platform = providerPlatform[integration.provider];
  if (!platform) {
    return reply.code(400).send({ error: `${integration.provider} OAuth is not available yet.` });
  }

  const profileId = await getZernioProfileId();
  const openerOrigin =
    readWebOrigin(startBody.openerOrigin) ?? readWebOrigin(request.headers.origin) ?? fallbackFrontendOrigin;
  const redirectUrl = new URL(`/api/integrations/${encodeURIComponent(integration.provider)}/oauth/callback`, appUrl);
  if (startQuery.popup === "1") {
    redirectUrl.searchParams.set("popup", "1");
    redirectUrl.searchParams.set("origin", openerOrigin);
  }
  const zernioQuery = new URLSearchParams({
    profileId,
    redirect_url: redirectUrl.toString(),
  });
  const data = await zernioFetch<{ authUrl?: string; url?: string; connectUrl?: string }>(
    `/connect/${platform}?${zernioQuery.toString()}`,
  );
  const url = data.authUrl ?? data.url ?? data.connectUrl;

  if (!url) {
    throw new HttpError("Zernio did not return an OAuth URL.", 502);
  }

  return { url };
});

app.get("/api/integrations/:provider/oauth/callback", async (request, reply) => {
  const { provider } = z.object({ provider: z.string().min(1) }).parse(request.params);
  const query = z
    .object({
      error: z.string().optional(),
      accountName: z.string().optional(),
      displayName: z.string().optional(),
      origin: z.string().optional(),
      popup: z.string().optional(),
      username: z.string().optional(),
    })
    .passthrough()
    .parse(request.query ?? {});
  const popup = query.popup === "1";
  const popupTargetOrigin = readWebOrigin(query.origin) ?? fallbackFrontendOrigin;
  const redirectUrl = new URL(`/site/${store.site.id}/integrations`, frontendUrl);
  const integration = findIntegration(provider);

  if (!integration) {
    redirectUrl.searchParams.set("integration_error", "unknown_provider");
    return finishIntegrationOAuth(reply, popup, redirectUrl, {
      type: "moxio:integration-oauth",
      ok: false,
      provider,
      error: "unknown_provider",
    }, popupTargetOrigin);
  }

  if (query.error) {
    integration.status = "needs_attention";
    redirectUrl.searchParams.set("integration_error", query.error);
    return finishIntegrationOAuth(reply, popup, redirectUrl, {
      type: "moxio:integration-oauth",
      ok: false,
      provider: integration.provider,
      error: query.error,
    }, popupTargetOrigin);
  }

  integration.status = "connected";
  integration.accountName = query.accountName ?? query.displayName ?? query.username ?? integration.accountName;
  integration.lastSyncAt = new Date().toISOString();

  redirectUrl.searchParams.set("integration_connected", integration.provider);
  return finishIntegrationOAuth(reply, popup, redirectUrl, {
    type: "moxio:integration-oauth",
    ok: true,
    provider: integration.provider,
  }, popupTargetOrigin);
});

app.post("/api/actions/:actionName", async (request, reply) => {
  const params = z.object({ actionName: z.string() }).parse(request.params);
  const body = z
    .object({
      source: z.enum(["ui", "chat"]).default("ui"),
      confirmed: z.boolean().optional(),
      payload: z.unknown().default({}),
    })
    .parse(request.body ?? {});

  try {
    return executeAction(params.actionName, body);
  } catch (error) {
    if (isActionError(error)) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Validation failed.", details: error.flatten() });
    }
    throw error;
  }
});

app.post("/api/chat", async (request, reply) => {
  const body = z
    .object({
      message: z.string().min(1),
      currentPage: z.string().optional(),
      selectedProjectId: z.string().optional(),
      selectedContentGroupId: z.string().optional(),
    })
    .parse(request.body ?? {});

  try {
    return handleChatTurn(body);
  } catch (error) {
    if (isActionError(error)) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Validation failed.", details: error.flatten() });
    }
    throw error;
  }
});

app.post("/api/ai/chat", async (request, reply) => {
  const body = z
    .object({
      messages: z.array(z.custom<AiChatRequestBody["messages"][number]>()).default([]),
      currentPage: z.string().optional(),
      selectedProjectId: z.string().optional(),
      selectedContentGroupId: z.string().optional(),
    })
    .parse(request.body ?? {});

  const abortController = new AbortController();
  request.raw.on("close", () => abortController.abort());

  const response = await createAccountManagerChatResponse(
    {
      ...body,
      messages: body.messages,
    },
    abortController.signal,
  );

  return sendWebResponse(reply, response);
});

app.get("/api/projects", async () => ({ projects: store.projects }));

app.get("/api/projects/:projectId", async (request, reply) => {
  const { projectId } = z.object({ projectId: z.string() }).parse(request.params);
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    return reply.code(404).send({ error: "Project not found." });
  }
  return { project };
});

app.get("/api/content-groups/:groupId", async (request, reply) => {
  const { groupId } = z.object({ groupId: z.string() }).parse(request.params);
  const group = store.contentGroups.find((item) => item.id === groupId);
  if (!group) {
    return reply.code(404).send({ error: "Content group not found." });
  }
  return {
    group,
    items: store.contentItems.filter((item) => group.itemIds.includes(item.id)),
  };
});

app.get("/api/audit", async () => ({ auditEvents: store.auditEvents }));

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: "Validation failed.", details: error.flatten() });
  }
  return reply.code(500).send({ error: "Unexpected server error." });
});

await app.listen({ port, host });
