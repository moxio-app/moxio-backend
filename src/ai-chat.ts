import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { handleChatTurn } from "./chat.js";

const MODEL_ID = process.env.MOXIO_AI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export type AiChatRequestBody = {
  messages: UIMessage[];
  currentPage?: string;
  selectedProjectId?: string;
  selectedContentGroupId?: string;
};

type BackendChatResult = ReturnType<typeof handleChatTurn>;

const textFromMessage = (message: UIMessage | undefined) =>
  message?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim() ?? "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fallbackText = (routing: BackendChatResult) =>
  `${routing.reply}\n\nLoaded tools: ${routing.loadedToolBundles.join(", ")}.`;

const streamFallbackReply = (messages: UIMessage[], reply: string) =>
  createUIMessageStream<UIMessage>({
    originalMessages: messages,
    execute: async ({ writer }) => {
      const textId = crypto.randomUUID();

      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: textId });

      for (const chunk of reply.match(/.{1,28}(\s|$)/g) ?? [reply]) {
        writer.write({ type: "text-delta", id: textId, delta: chunk });
        await sleep(18);
      }

      writer.write({ type: "text-end", id: textId });
      writer.write({ type: "finish", finishReason: "stop" });
    },
  });

const systemPrompt = (input: AiChatRequestBody, routing: BackendChatResult) => `
You are the Account Manager Agent inside moxio, an AI-first marketing workspace.

Product model:
- The workspace is chat-first.
- Projects replace the old Strategies model.
- Team and Site still exist; Projects, media, content review, and Context Hub are scoped to the current Site.
- The Site-shared Context Hub stores reusable company, audience, product, research, industry, and case-study context.
- You guide users through new Project creation and load only the tools needed for the current intent.

Operating style:
- Be direct, useful, and concise.
- Use plain English.
- Do not claim to have completed an external integration, published content, or changed files unless the backend routing note says an action happened.
- When a user asks what to do next, give the next concrete step for the current page or selected Project.
- If the routing note says tools were loaded, treat those as the only available tool bundles for this turn.

Current context:
- Current page: ${input.currentPage ?? "home"}
- Selected Project ID: ${input.selectedProjectId ?? "none"}
- Selected content group ID: ${input.selectedContentGroupId ?? "none"}
- Backend intent: ${routing.intent}
- Loaded tool bundles: ${routing.loadedToolBundles.join(", ")}
- Backend routing note: ${routing.reply}
`.trim();

const shouldUseModelChat = () =>
  process.env.MOXIO_USE_MODEL_CHAT === "true" && Boolean(process.env.OPENAI_API_KEY);

const streamModelReply = async (
  input: AiChatRequestBody,
  routing: BackendChatResult,
  signal: AbortSignal,
) => {
  const result = streamText({
    model: openai(MODEL_ID),
    system: systemPrompt(input, routing),
    messages: await convertToModelMessages(input.messages),
    abortSignal: signal,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: input.messages,
  });
};

export const createAccountManagerChatResponse = async (
  input: AiChatRequestBody,
  signal: AbortSignal,
) => {
  const latestMessage = textFromMessage(input.messages.at(-1));
  const routing = handleChatTurn({
    message: latestMessage,
    currentPage: input.currentPage,
    selectedProjectId: input.selectedProjectId,
    selectedContentGroupId: input.selectedContentGroupId,
  });

  if (shouldUseModelChat()) {
    return streamModelReply(input, routing, signal);
  }

  return createUIMessageStreamResponse({
    stream: streamFallbackReply(input.messages, fallbackText(routing)),
  });
};
