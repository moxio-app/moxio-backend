import { z } from "zod";
import type {
  ActionRequest,
  ActionResult,
  ContentGroup,
  ContentItem,
  Deliverables,
  DocumentState,
  Project,
  ProjectDocument,
  RiskLevel,
} from "./types.js";
import { createAuditEvent, createId, store, touchProject } from "./store.js";

const now = () => new Date().toISOString();
const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

class ActionError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}

type ActionHandler<T = unknown> = (request: ActionRequest) => ActionResult<T>;

interface RegisteredAction<T = unknown> {
  risk: RiskLevel;
  targetType: string;
  getTargetId: (payload: unknown) => string;
  preview: (payload: unknown) => string;
  execute: ActionHandler<T>;
}

const requireConfirmation = <T>(
  actionName: string,
  action: RegisteredAction<T>,
  request: ActionRequest,
): ActionResult<T> | null => {
  if (action.risk === "low" || request.confirmed) {
    return null;
  }

  return {
    requiresConfirmation: true,
    actionName,
    risk: action.risk,
    preview: action.preview(request.payload),
    targetType: action.targetType,
    targetId: action.getTargetId(request.payload),
  };
};

const success = <T>(
  actionName: string,
  risk: RiskLevel,
  message: string,
  data: T,
  auditInput?: {
    targetType: string;
    targetId: string;
    previousValueSummary: string;
    newValueSummary: string;
    source: ActionRequest["source"];
    confirmationState?: "not_required" | "confirmed";
  },
): ActionResult<T> => {
  const auditEvent =
    auditInput &&
    createAuditEvent({
      actionName,
      targetType: auditInput.targetType,
      targetId: auditInput.targetId,
      previousValueSummary: auditInput.previousValueSummary,
      newValueSummary: auditInput.newValueSummary,
      confirmationState:
        auditInput.confirmationState ?? (risk === "low" ? "not_required" : "confirmed"),
      source: auditInput.source,
    });

  return {
    requiresConfirmation: false,
    actionName,
    risk,
    message,
    data,
    auditEvent,
  };
};

const findProject = (projectId: string) => {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new ActionError("Project not found.", 404);
  }
  return project;
};

const findDocument = (project: Project, documentIdOrType: string) => {
  const document = project.documents.find(
    (item) => item.id === documentIdOrType || item.type === documentIdOrType,
  );
  if (!document) {
    throw new ActionError("Project document not found.", 404);
  }
  return document;
};

const findContentItem = (itemId: string) => {
  const item = store.contentItems.find((contentItem) => contentItem.id === itemId);
  if (!item) {
    throw new ActionError("Content item not found.", 404);
  }
  return item;
};

const findContentGroup = (groupId: string) => {
  const group = store.contentGroups.find((contentGroup) => contentGroup.id === groupId);
  if (!group) {
    throw new ActionError("Content group not found.", 404);
  }
  return group;
};

const findMediaAsset = (assetId: string) => {
  const asset = store.mediaAssets.find((mediaAsset) => mediaAsset.id === assetId);
  if (!asset) {
    throw new ActionError("Media asset not found.", 404);
  }
  return asset;
};

const documentBodyForType = (type: ProjectDocument["type"]) => {
  if (type === "overview") return "## Overview.md\n\nEmpty project overview. The Account Manager will draft this from the project brief.";
  if (type === "voice") return "## Project-Voice.md\n\nEmpty project voice. The Voice Agent will draft this from Site Context Hub and project instructions.";
  if (type === "context") return "## Context\n\nNo context profiles selected yet.";
  if (type === "designs") return "## Designs.md\n\nNo design references selected yet.";
  if (type === "sources") return "## Sources\n\nNo sources attached yet.";
  return "## Deliverables\n\nNo deliverable counts planned yet.";
};

const createProjectDocuments = (): ProjectDocument[] =>
  (["overview", "voice"] as ProjectDocument["type"][]).map(
    (type) => ({
      id: createId("doc"),
      type,
      title:
        type === "overview"
          ? "Overview.md"
          : type === "voice"
            ? "Project-Voice.md"
            : type === "designs"
              ? "Designs.md"
              : type[0]!.toUpperCase() + type.slice(1),
      body: documentBodyForType(type),
      state: type === "overview" ? "in_progress" : "empty",
      version: type === "overview" ? 1 : 0,
      lastEditedBy: store.currentUser.id,
      updatedAt: now(),
      sourceReferences: [],
    }),
  );

const createEmptyProjectSchema = z.object({
  name: z.string().trim().min(1).default("Untitled Project"),
  summary: z.string().trim().optional(),
});

const updateScopeDocumentSchema = z.object({
  projectId: z.string().min(1),
  documentIdOrType: z.string().min(1),
  body: z.string().min(1),
  state: z
    .enum(["empty", "in_progress", "awaiting_approval", "approved", "rejected"])
    .optional(),
});

const approveDocumentSchema = z.object({
  projectId: z.string().min(1),
  documentIdOrType: z.string().min(1),
});

const rejectDocumentSchema = approveDocumentSchema.extend({
  reason: z.string().trim().min(3),
});

const projectActionSchema = z.object({
  projectId: z.string().min(1),
});

const shareProjectSchema = projectActionSchema.extend({
  visibility: z.enum(["private", "public"]),
});

const planDeliverablesSchema = z.object({
  projectId: z.string().min(1),
  facebookCount: z.number().int().min(0).max(20),
  webCount: z.number().int().min(0).max(20),
  emailCount: z.number().int().min(0).max(20),
  scheduleRange: z.string().trim().min(1),
  cadence: z.string().trim().min(1),
  destinationAccounts: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

const globalContextSchema = z.object({
  documentId: z.string().min(1),
  fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

const contextEntrySchema = z.object({
  type: z.enum(["audience", "product_service", "service", "deep_research", "industry", "case_study"]),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  body: z.string().trim().min(1),
  url: z.string().url().optional().or(z.literal("")),
});

const mediaUploadSchema = z.object({
  title: z.string().trim().min(1),
  mediaType: z.enum(["image", "video"]).default("image"),
  tags: z.array(z.string()).default([]),
  folder: z.string().default("AI Generations"),
  altText: z.string().default(""),
  notes: z.string().default(""),
});

const mediaUpdateSchema = z.object({
  assetId: z.string().min(1),
  title: z.string().trim().min(1).optional(),
  thumbnail: z.string().trim().optional(),
  tags: z.array(z.string().trim()).optional(),
  folder: z.string().trim().optional(),
  altText: z.string().optional(),
  notes: z.string().optional(),
});

const updateContentSchema = z.object({
  itemId: z.string().min(1),
  changes: z.record(z.string(), z.unknown()),
});

const contentItemSchema = z.object({
  itemId: z.string().min(1),
});

const duplicateContentSchema = contentItemSchema.extend({
  platforms: z.array(z.string().trim().min(1)).optional(),
  scheduledFor: z.string().trim().min(1).optional(),
  status: z
    .enum(["draft", "need_revision", "pending", "scheduled", "approved", "rejected", "live", "published", "failed"])
    .optional(),
});

const rejectContentSchema = contentItemSchema.extend({
  reason: z.string().trim().min(3),
});

const rescheduleContentSchema = contentItemSchema.extend({
  scheduledFor: z.string().trim().min(1),
  status: z
    .enum(["draft", "need_revision", "pending", "scheduled", "approved", "rejected", "live", "published", "failed"])
    .optional(),
});

const bulkReviewSchema = z.object({
  itemIds: z.array(z.string()).min(1),
  action: z.enum(["approve", "reject"]),
  reason: z.string().optional(),
});

const shareContentSchema = z.object({
  groupId: z.string().min(1),
  visibility: z.enum(["private", "public"]),
});

const integrationSchema = z.object({
  provider: z.enum([
    "Facebook",
    "Instagram",
    "LinkedIn",
    "Twitter",
    "TikTok",
    "Bluesky",
    "Threads",
    "Mailchimp",
    "HubSpot",
    "WordPress",
    "GA4",
  ]),
  accountName: z.string().trim().min(1),
});

const actionRegistry: Record<string, RegisteredAction> = {
  "project.create_empty_scope": {
    risk: "medium",
    targetType: "project",
    getTargetId: () => "new",
    preview: (payload) => {
      const parsed = createEmptyProjectSchema.parse(payload);
      return `Create a new Project named "${parsed.name}" in Site ${store.site.name}.`;
    },
    execute: (request) => {
      const parsed = createEmptyProjectSchema.parse(request.payload);
      const project: Project = {
        id: createId("project"),
        siteId: store.site.id,
        name: parsed.name,
        ownerId: store.currentUser.id,
        reviewerId: "user-2",
        modifiedAt: now(),
        summary:
          parsed.summary ??
          "New Project scope started by the Account Manager. Required context and deliverables are still being gathered.",
        documents: createProjectDocuments(),
        workLogs: [],
        deliverables: {
          facebookCount: 0,
          webCount: 0,
          emailCount: 0,
          scheduleRange: "Not planned",
          cadence: "Not planned",
          destinationAccounts: [],
          notes: "",
        },
        contextProfileIds: [],
        mediaIds: [],
        sourceFileIds: [],
        shareState: "private",
      };

      store.projects.unshift(project);

      return success("project.create_empty_scope", "medium", "Project scope created.", project, {
        targetType: "project",
        targetId: project.id,
        previousValueSummary: "No project existed.",
        newValueSummary: `Created ${project.name}.`,
        source: request.source,
      });
    },
  },
  "project.delete": {
    risk: "high",
    targetType: "project",
    getTargetId: (payload) => projectActionSchema.parse(payload).projectId,
    preview: (payload) => {
      const project = findProject(projectActionSchema.parse(payload).projectId);
      return `Delete Project "${project.name}" and remove its mock content groups from this workspace.`;
    },
    execute: (request) => {
      const parsed = projectActionSchema.parse(request.payload);
      const project = findProject(parsed.projectId);
      const previous = project.name;
      const relatedGroupIds = store.contentGroups
        .filter((group) => group.projectId === project.id)
        .map((group) => group.id);

      store.projects = store.projects.filter((item) => item.id !== project.id);
      store.contentGroups = store.contentGroups.filter((group) => group.projectId !== project.id);
      store.contentItems = store.contentItems.filter((item) => !relatedGroupIds.includes(item.contentGroupId));
      store.mediaAssets.forEach((asset) => {
        asset.projectIds = asset.projectIds.filter((projectId) => projectId !== project.id);
        asset.contentItemIds = asset.contentItemIds.filter(
          (itemId) => store.contentItems.some((item) => item.id === itemId),
        );
      });

      return success("project.delete", "high", "Project deleted.", { projectId: project.id }, {
        targetType: "project",
        targetId: project.id,
        previousValueSummary: previous,
        newValueSummary: "Deleted",
        source: request.source,
      });
    },
  },
  "project.share": {
    risk: "high",
    targetType: "project",
    getTargetId: (payload) => shareProjectSchema.parse(payload).projectId,
    preview: (payload) => {
      const parsed = shareProjectSchema.parse(payload);
      const project = findProject(parsed.projectId);
      return `Set Project "${project.name}" sharing to ${parsed.visibility}.`;
    },
    execute: (request) => {
      const parsed = shareProjectSchema.parse(request.payload);
      const project = findProject(parsed.projectId);
      const previous = project.shareState;
      project.shareState = parsed.visibility;
      touchProject(project);

      return success("project.share", "high", "Project share visibility updated.", project, {
        targetType: "project",
        targetId: project.id,
        previousValueSummary: previous,
        newValueSummary: project.shareState,
        source: request.source,
      });
    },
  },
  "project.update_scope_document": {
    risk: "medium",
    targetType: "project_document",
    getTargetId: (payload) => updateScopeDocumentSchema.parse(payload).documentIdOrType,
    preview: (payload) => {
      const parsed = updateScopeDocumentSchema.parse(payload);
      return `Update ${parsed.documentIdOrType} on Project ${parsed.projectId}.`;
    },
    execute: (request) => {
      const parsed = updateScopeDocumentSchema.parse(request.payload);
      const project = findProject(parsed.projectId);
      const target = findDocument(project, parsed.documentIdOrType);
      const previous = `${target.title} v${target.version}: ${target.state}`;

      target.body = parsed.body;
      target.state = (parsed.state ?? "awaiting_approval") as DocumentState;
      target.version += 1;
      target.lastEditedBy = store.currentUser.id;
      target.updatedAt = now();
      delete target.approval;
      delete target.rejectionReason;
      touchProject(project);

      return success("project.update_scope_document", "medium", "Scope document updated.", project, {
        targetType: "project_document",
        targetId: target.id,
        previousValueSummary: previous,
        newValueSummary: `${target.title} v${target.version}: ${target.state}`,
        source: request.source,
      });
    },
  },
  "project.approve_document": {
    risk: "medium",
    targetType: "project_document",
    getTargetId: (payload) => approveDocumentSchema.parse(payload).documentIdOrType,
    preview: (payload) => {
      const parsed = approveDocumentSchema.parse(payload);
      const project = findProject(parsed.projectId);
      const target = findDocument(project, parsed.documentIdOrType);
      return `Approve ${target.title} version ${target.version} for ${project.name}.`;
    },
    execute: (request) => {
      const parsed = approveDocumentSchema.parse(request.payload);
      const project = findProject(parsed.projectId);
      const target = findDocument(project, parsed.documentIdOrType);
      const previous = `${target.title}: ${target.state}`;

      target.state = "approved";
      target.approval = {
        approvedBy: store.currentUser.id,
        approvedAt: now(),
      };
      delete target.rejectionReason;
      target.updatedAt = now();
      touchProject(project);

      return success("project.approve_document", "medium", "Document approved.", project, {
        targetType: "project_document",
        targetId: target.id,
        previousValueSummary: previous,
        newValueSummary: `${target.title}: approved`,
        source: request.source,
      });
    },
  },
  "project.reject_document": {
    risk: "medium",
    targetType: "project_document",
    getTargetId: (payload) => rejectDocumentSchema.parse(payload).documentIdOrType,
    preview: (payload) => {
      const parsed = rejectDocumentSchema.parse(payload);
      return `Reject document ${parsed.documentIdOrType} with reason: ${parsed.reason}`;
    },
    execute: (request) => {
      const parsed = rejectDocumentSchema.parse(request.payload);
      const project = findProject(parsed.projectId);
      const target = findDocument(project, parsed.documentIdOrType);
      const previous = `${target.title}: ${target.state}`;

      target.state = "rejected";
      target.rejectionReason = parsed.reason;
      target.updatedAt = now();
      touchProject(project);

      return success("project.reject_document", "medium", "Document rejected.", project, {
        targetType: "project_document",
        targetId: target.id,
        previousValueSummary: previous,
        newValueSummary: `${target.title}: rejected because ${parsed.reason}`,
        source: request.source,
      });
    },
  },
  "project.plan_deliverables": {
    risk: "medium",
    targetType: "project",
    getTargetId: (payload) => planDeliverablesSchema.parse(payload).projectId,
    preview: (payload) => {
      const parsed = planDeliverablesSchema.parse(payload);
      return `Plan deliverables: ${parsed.facebookCount} Facebook, ${parsed.webCount} web, ${parsed.emailCount} email for ${parsed.scheduleRange}.`;
    },
    execute: (request) => {
      const parsed = planDeliverablesSchema.parse(request.payload);
      const project = findProject(parsed.projectId);
      const previous = JSON.stringify(project.deliverables);
      const deliverables: Deliverables = {
        facebookCount: parsed.facebookCount,
        webCount: parsed.webCount,
        emailCount: parsed.emailCount,
        scheduleRange: parsed.scheduleRange,
        cadence: parsed.cadence,
        destinationAccounts: parsed.destinationAccounts,
        notes: parsed.notes,
      };

      project.deliverables = deliverables;
      const doc = findDocument(project, "deliverables");
      doc.body = `## Deliverables\n\n- Facebook count: ${deliverables.facebookCount}\n- Web count: ${deliverables.webCount}\n- Email count: ${deliverables.emailCount}\n- Schedule range: ${deliverables.scheduleRange}\n- Cadence: ${deliverables.cadence}\n- Destinations: ${deliverables.destinationAccounts.join(", ") || "Not selected"}\n\n${deliverables.notes}`;
      doc.state = "awaiting_approval";
      doc.version += 1;
      doc.updatedAt = now();
      touchProject(project);

      return success("project.plan_deliverables", "medium", "Deliverables planned.", project, {
        targetType: "project",
        targetId: project.id,
        previousValueSummary: previous,
        newValueSummary: JSON.stringify(project.deliverables),
        source: request.source,
      });
    },
  },
  "project.create_content_group": {
    risk: "medium",
    targetType: "project",
    getTargetId: (payload) => z.object({ projectId: z.string() }).parse(payload).projectId,
    preview: (payload) => {
      const project = findProject(z.object({ projectId: z.string() }).parse(payload).projectId);
      return `Create a content group from ${project.name} using current deliverable counts.`;
    },
    execute: (request) => {
      const { projectId } = z.object({ projectId: z.string() }).parse(request.payload);
      const project = findProject(projectId);
      if (project.contentGroupId) {
        return success("project.create_content_group", "medium", "Project already has a content group.", project, {
          targetType: "project",
          targetId: project.id,
          previousValueSummary: `Existing content group ${project.contentGroupId}.`,
          newValueSummary: "No duplicate group created.",
          source: request.source,
        });
      }

      const itemIds: string[] = [];
      const createdItems: ContentItem[] = [];

      for (let index = 0; index < project.deliverables.facebookCount; index += 1) {
        const id = createId("item");
        itemIds.push(id);
        createdItems.push({
          id,
          contentGroupId: "",
          projectId: project.id,
          type: "social",
          platform: "Facebook",
          status: "pending",
          scheduledFor: daysFromNow(3 + index),
          mediaIds: project.mediaIds.slice(0, 1),
          tags: ["launch"],
          comments: [],
          history: ["Generated from Project deliverables."],
          shareState: "private",
          body: `Draft Facebook post ${index + 1} for ${project.name}.`,
          hashtags: ["#moxio", "#MarketingAI"],
        });
      }

      for (let index = 0; index < project.deliverables.emailCount; index += 1) {
        const id = createId("item");
        itemIds.push(id);
        createdItems.push({
          id,
          contentGroupId: "",
          projectId: project.id,
          type: "email",
          platform: "Mailchimp",
          status: "draft",
          scheduledFor: daysFromNow(5 + index * 2),
          mediaIds: [],
          tags: ["email"],
          comments: [],
          history: ["Generated from Project deliverables."],
          shareState: "private",
          subject: `${project.name}: email draft ${index + 1}`,
          preheader: "Generated from approved Project scope.",
          body: `Email draft ${index + 1} for ${project.name}.`,
          recipientList: "Primary marketing audience",
          template: "Default Campaign",
          integrations: {
            salesforce: false,
            ga4: true,
          },
        });
      }

      for (let index = 0; index < project.deliverables.webCount; index += 1) {
        const id = createId("item");
        itemIds.push(id);
        createdItems.push({
          id,
          contentGroupId: "",
          projectId: project.id,
          type: "web",
          platform: "WordPress",
          status: "draft",
          scheduledFor: daysFromNow(7 + index),
          mediaIds: project.mediaIds.slice(0, 1),
          tags: ["article"],
          comments: [],
          history: ["Generated from Project deliverables."],
          shareState: "private",
          title: `${project.name}: web article draft ${index + 1}`,
          body: `Article draft ${index + 1} for ${project.name}.`,
          metaKeywords: ["moxio", "marketing workspace"],
          metaDescription: "Generated web article draft from approved Project scope.",
          categories: ["Campaigns"],
        });
      }

      const groupId = createId("group");
      createdItems.forEach((item) => {
        item.contentGroupId = groupId;
      });

      const group: ContentGroup = {
        id: groupId,
        siteId: store.site.id,
        projectId: project.id,
        name: `${project.name} Content`,
        status: "in_review",
        scheduleRange: project.deliverables.scheduleRange,
        itemIds,
        shareState: "private",
        modifiedAt: now(),
      };

      store.contentItems.unshift(...createdItems);
      store.contentGroups.unshift(group);
      project.contentGroupId = group.id;
      touchProject(project);

      return success("project.create_content_group", "medium", "Content group created.", { project, group, items: createdItems }, {
        targetType: "project",
        targetId: project.id,
        previousValueSummary: "No content group.",
        newValueSummary: `Created ${group.name} with ${itemIds.length} items.`,
        source: request.source,
      });
    },
  },
  "context.update_global_document": {
    risk: "medium",
    targetType: "context_global_document",
    getTargetId: (payload) => globalContextSchema.parse(payload).documentId,
    preview: (payload) => {
      const parsed = globalContextSchema.parse(payload);
      return `Update global Context Hub document ${parsed.documentId}.`;
    },
    execute: (request) => {
      const parsed = globalContextSchema.parse(request.payload);
      const target = store.globalContextDocuments.find((doc) => doc.id === parsed.documentId);
      if (!target) throw new ActionError("Global context document not found.", 404);
      const previous = JSON.stringify(target.fields);
      target.fields = { ...target.fields, ...parsed.fields };
      target.updatedAt = now();
      target.updatedBy = store.currentUser.id;

      return success("context.update_global_document", "medium", "Context document updated.", target, {
        targetType: "context_global_document",
        targetId: target.id,
        previousValueSummary: previous,
        newValueSummary: JSON.stringify(target.fields),
        source: request.source,
      });
    },
  },
  "context.create_entry": {
    risk: "medium",
    targetType: "context_profile",
    getTargetId: () => "new",
    preview: (payload) => {
      const parsed = contextEntrySchema.parse(payload);
      return `Create ${parsed.type} context profile "${parsed.title}" in the Site Context Hub.`;
    },
    execute: (request) => {
      const parsed = contextEntrySchema.parse(request.payload);
      const entry = {
        id: createId("ctx"),
        siteId: store.site.id,
        type: parsed.type,
        title: parsed.title,
        url: parsed.url || undefined,
        summary: parsed.summary,
        body: parsed.body,
        associatedProjectIds: [],
        associatedMediaIds: [],
        knowledgeBaseFileIds: [],
        ownerId: store.currentUser.id,
        createdAt: now(),
        comments: [],
        shareState: "site" as const,
      };

      store.contextProfiles.unshift(entry);

      return success("context.create_entry", "medium", "Context profile created.", entry, {
        targetType: "context_profile",
        targetId: entry.id,
        previousValueSummary: "No context profile existed.",
        newValueSummary: `Created ${entry.title}.`,
        source: request.source,
      });
    },
  },
  "media.upload_mock": {
    risk: "medium",
    targetType: "media_asset",
    getTargetId: () => "new",
    preview: (payload) => {
      const parsed = mediaUploadSchema.parse(payload);
      return `Add media asset "${parsed.title}" to ${parsed.folder}.`;
    },
    execute: (request) => {
      const parsed = mediaUploadSchema.parse(request.payload);
      const asset = {
        id: createId("media"),
        siteId: store.site.id,
        title: parsed.title,
        fileType: parsed.mediaType === "video" ? "mp4" : "png",
        mediaType: parsed.mediaType,
        thumbnail:
          parsed.mediaType === "video"
            ? "linear-gradient(135deg, #ff9f7a, #8067ff)"
            : "linear-gradient(135deg, #85f7ff, #9b8cff)",
        tags: parsed.tags,
        folder: parsed.folder,
        projectIds: [],
        contentItemIds: [],
        altText: parsed.altText,
        notes: parsed.notes,
        aiGenerated: false,
        createdAt: now(),
      };

      store.mediaAssets.unshift(asset);

      return success("media.upload_mock", "medium", "Media asset added.", asset, {
        targetType: "media_asset",
        targetId: asset.id,
        previousValueSummary: "No media asset existed.",
        newValueSummary: `Added ${asset.title}.`,
        source: request.source,
      });
    },
  },
  "media.update_metadata": {
    risk: "medium",
    targetType: "media_asset",
    getTargetId: (payload) => mediaUpdateSchema.parse(payload).assetId,
    preview: (payload) => {
      const parsed = mediaUpdateSchema.parse(payload);
      return `Update media asset ${parsed.assetId}.`;
    },
    execute: (request) => {
      const parsed = mediaUpdateSchema.parse(request.payload);
      const asset = findMediaAsset(parsed.assetId);
      const previous = JSON.stringify(asset);

      if (parsed.title !== undefined) asset.title = parsed.title;
      if (parsed.thumbnail !== undefined && parsed.thumbnail) asset.thumbnail = parsed.thumbnail;
      if (parsed.tags !== undefined) asset.tags = parsed.tags.filter(Boolean);
      if (parsed.folder !== undefined) asset.folder = parsed.folder;
      if (parsed.altText !== undefined) asset.altText = parsed.altText;
      if (parsed.notes !== undefined) asset.notes = parsed.notes;

      return success("media.update_metadata", "medium", "Media asset updated.", asset, {
        targetType: "media_asset",
        targetId: asset.id,
        previousValueSummary: previous,
        newValueSummary: JSON.stringify(asset),
        source: request.source,
      });
    },
  },
  "content.update_item": {
    risk: "medium",
    targetType: "content_item",
    getTargetId: (payload) => updateContentSchema.parse(payload).itemId,
    preview: (payload) => {
      const parsed = updateContentSchema.parse(payload);
      return `Update content item ${parsed.itemId}: ${Object.keys(parsed.changes).join(", ")}.`;
    },
    execute: (request) => {
      const parsed = updateContentSchema.parse(request.payload);
      const item = findContentItem(parsed.itemId);
      const previous = JSON.stringify(item);
      Object.assign(item, parsed.changes, {
        history: [`Updated ${Object.keys(parsed.changes).join(", ")} by ${request.source}.`, ...item.history],
      });

      return success("content.update_item", "medium", "Content item updated.", item, {
        targetType: "content_item",
        targetId: item.id,
        previousValueSummary: previous,
        newValueSummary: JSON.stringify(item),
        source: request.source,
      });
    },
  },
  "content.approve": {
    risk: "medium",
    targetType: "content_item",
    getTargetId: (payload) => contentItemSchema.parse(payload).itemId,
    preview: (payload) => `Approve content item ${contentItemSchema.parse(payload).itemId}.`,
    execute: (request) => {
      const parsed = contentItemSchema.parse(request.payload);
      const item = findContentItem(parsed.itemId);
      const previous = item.status;
      item.status = "approved";
      item.history.unshift("Approved for scheduling.");

      return success("content.approve", "medium", "Content item approved.", item, {
        targetType: "content_item",
        targetId: item.id,
        previousValueSummary: previous,
        newValueSummary: item.status,
        source: request.source,
      });
    },
  },
  "content.reject": {
    risk: "medium",
    targetType: "content_item",
    getTargetId: (payload) => rejectContentSchema.parse(payload).itemId,
    preview: (payload) => {
      const parsed = rejectContentSchema.parse(payload);
      return `Reject content item ${parsed.itemId} with reason: ${parsed.reason}.`;
    },
    execute: (request) => {
      const parsed = rejectContentSchema.parse(request.payload);
      const item = findContentItem(parsed.itemId);
      const previous = item.status;
      item.status = "rejected";
      item.comments.unshift(parsed.reason);
      item.history.unshift(`Rejected: ${parsed.reason}`);

      return success("content.reject", "medium", "Content item rejected.", item, {
        targetType: "content_item",
        targetId: item.id,
        previousValueSummary: previous,
        newValueSummary: `rejected: ${parsed.reason}`,
        source: request.source,
      });
    },
  },
  "content.reschedule": {
    risk: "medium",
    targetType: "content_item",
    getTargetId: (payload) => rescheduleContentSchema.parse(payload).itemId,
    preview: (payload) => {
      const parsed = rescheduleContentSchema.parse(payload);
      return `Reschedule content item ${parsed.itemId} to ${parsed.scheduledFor}.`;
    },
    execute: (request) => {
      const parsed = rescheduleContentSchema.parse(request.payload);
      const item = findContentItem(parsed.itemId);
      const previous = {
        scheduledFor: item.scheduledFor,
        status: item.status,
      };
      item.scheduledFor = parsed.scheduledFor;
      if (parsed.status) {
        item.status = parsed.status;
      }
      item.history.unshift(
        parsed.status && parsed.status !== previous.status
          ? `Rescheduled from ${previous.scheduledFor} to ${item.scheduledFor} and changed status from ${previous.status} to ${item.status}.`
          : `Rescheduled from ${previous.scheduledFor} to ${item.scheduledFor}.`,
      );
      findContentGroup(item.contentGroupId).modifiedAt = now();
      touchProject(findProject(item.projectId));

      return success("content.reschedule", "medium", "Content item rescheduled.", item, {
        targetType: "content_item",
        targetId: item.id,
        previousValueSummary: JSON.stringify(previous),
        newValueSummary: JSON.stringify({
          scheduledFor: item.scheduledFor,
          status: item.status,
        }),
        source: request.source,
      });
    },
  },
  "content.duplicate": {
    risk: "medium",
    targetType: "content_item",
    getTargetId: (payload) => duplicateContentSchema.parse(payload).itemId,
    preview: (payload) => {
      const parsed = duplicateContentSchema.parse(payload);
      const targetPlatforms = parsed.platforms?.length ? parsed.platforms.join(", ") : "the same platform";
      return `Duplicate content item ${parsed.itemId} to ${targetPlatforms}.`;
    },
    execute: (request) => {
      const parsed = duplicateContentSchema.parse(request.payload);
      const item = findContentItem(parsed.itemId);
      const group = findContentGroup(item.contentGroupId);
      const project = findProject(item.projectId);
      const targetPlatforms = parsed.platforms?.length ? parsed.platforms : [item.platform];
      const targetStatus = parsed.status ?? "draft";
      const targetScheduledFor = parsed.scheduledFor
        ? new Date(parsed.scheduledFor).toISOString()
        : daysFromNow(1);

      const duplicates = targetPlatforms.map((platform) => {
        const duplicate = {
          ...item,
          id: createId("item"),
          platform,
          status: targetStatus,
          scheduledFor: targetScheduledFor,
          comments: [],
          history: [`Duplicated from ${item.id} for ${platform}.`, ...item.history],
        } as ContentItem;

        if (duplicate.type === "email") {
          duplicate.subject = `${duplicate.subject} copy`;
        }
        if (duplicate.type === "web") {
          duplicate.title = `${duplicate.title} copy`;
        }

        return duplicate;
      });

      const itemIndex = group.itemIds.indexOf(item.id);
      if (itemIndex >= 0) {
        group.itemIds.splice(itemIndex + 1, 0, ...duplicates.map((duplicate) => duplicate.id));
      } else {
        group.itemIds.push(...duplicates.map((duplicate) => duplicate.id));
      }
      group.modifiedAt = now();
      touchProject(project);
      store.contentItems.unshift(...duplicates);

      duplicates.forEach((duplicate) => {
        duplicate.mediaIds.forEach((mediaId) => {
          const asset = store.mediaAssets.find((media) => media.id === mediaId);
          if (asset && !asset.contentItemIds.includes(duplicate.id)) {
            asset.contentItemIds.push(duplicate.id);
          }
        });
      });

      return success("content.duplicate", "medium", "Content item duplicated.", duplicates, {
        targetType: "content_items",
        targetId: duplicates.map((duplicate) => duplicate.id).join(","),
        previousValueSummary: `${item.id}: ${item.status}`,
        newValueSummary: `${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}: ${targetStatus}`,
        source: request.source,
      });
    },
  },
  "content.bulk_review": {
    risk: "high",
    targetType: "content_items",
    getTargetId: (payload) => bulkReviewSchema.parse(payload).itemIds.join(","),
    preview: (payload) => {
      const parsed = bulkReviewSchema.parse(payload);
      return `${parsed.action === "approve" ? "Approve" : "Reject"} ${parsed.itemIds.length} selected content items.`;
    },
    execute: (request) => {
      const parsed = bulkReviewSchema.parse(request.payload);
      if (parsed.action === "reject" && !parsed.reason) {
        throw new ActionError("Bulk rejection requires a reason.");
      }
      const items = parsed.itemIds.map(findContentItem);
      const previous = items.map((item) => `${item.id}:${item.status}`).join(", ");
      items.forEach((item) => {
        item.status = parsed.action === "approve" ? "approved" : "rejected";
        item.history.unshift(
          parsed.action === "approve"
            ? "Approved through bulk review."
            : `Rejected through bulk review: ${parsed.reason}`,
        );
      });

      return success("content.bulk_review", "high", "Bulk review applied.", items, {
        targetType: "content_items",
        targetId: parsed.itemIds.join(","),
        previousValueSummary: previous,
        newValueSummary: `${parsed.action} ${items.length} items.`,
        source: request.source,
      });
    },
  },
  "content.share": {
    risk: "high",
    targetType: "content_group",
    getTargetId: (payload) => shareContentSchema.parse(payload).groupId,
    preview: (payload) => {
      const parsed = shareContentSchema.parse(payload);
      return `Set content group ${parsed.groupId} visibility to ${parsed.visibility}.`;
    },
    execute: (request) => {
      const parsed = shareContentSchema.parse(request.payload);
      const group = findContentGroup(parsed.groupId);
      const previous = group.shareState;
      group.shareState = parsed.visibility;
      group.modifiedAt = now();

      return success("content.share", "high", "Content share visibility updated.", group, {
        targetType: "content_group",
        targetId: group.id,
        previousValueSummary: previous,
        newValueSummary: group.shareState,
        source: request.source,
      });
    },
  },
  "integration.start_oauth": {
    risk: "high",
    targetType: "integration",
    getTargetId: () => "oauth",
    preview: (payload) => {
      const parsed = integrationSchema.parse(payload);
      return `Start a secure ${parsed.provider} connection flow for ${parsed.accountName}. No secrets will be handled in chat.`;
    },
    execute: (request) => {
      const parsed = integrationSchema.parse(request.payload);
      const integration = store.integrations.find((item) => item.provider === parsed.provider);

      return success("integration.start_oauth", "high", "Open the integration OAuth flow from the backend endpoint.", integration ?? parsed, {
        targetType: "integration",
        targetId: parsed.provider,
        previousValueSummary: `${parsed.provider} connection was not changed.`,
        newValueSummary: `OAuth should be started through /api/integrations/${parsed.provider}/oauth/start.`,
        source: request.source,
      });
    },
  },
};

export const listActions = () =>
  Object.entries(actionRegistry).map(([name, action]) => ({
    name,
    risk: action.risk,
    targetType: action.targetType,
  }));

export const executeAction = (actionName: string, request: ActionRequest) => {
  const action = actionRegistry[actionName];
  if (!action) {
    throw new ActionError(`Unknown action: ${actionName}`, 404);
  }

  const confirmation = requireConfirmation(actionName, action, request);
  if (confirmation) {
    return confirmation;
  }

  return action.execute(request);
};

export const isActionError = (error: unknown): error is ActionError => error instanceof ActionError;
