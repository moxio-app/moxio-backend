import { executeAction } from "./actions.js";
import { store } from "./store.js";

const includesAny = (message: string, words: string[]) =>
  words.some((word) => message.includes(word));

export const handleChatTurn = (input: {
  message: string;
  currentPage?: string;
  selectedProjectId?: string;
  selectedContentGroupId?: string;
}) => {
  const message = input.message.toLowerCase();

  if (includesAny(message, ["new project", "create project", "start a project"])) {
    const suggestedName =
      input.message.match(/called\s+(.+)$/i)?.[1]?.trim() ||
      input.message.match(/named\s+(.+)$/i)?.[1]?.trim() ||
      "AI-led Campaign Project";

    const action = executeAction("project.create_empty_scope", {
      source: "chat",
      confirmed: true,
      payload: {
        name: suggestedName,
        summary: "Created from the Account Manager chat. Continue by collecting audience, goal, source, and deliverable details.",
      },
    });

    return {
      intent: "new_project",
      loadedToolBundles: ["base", "project.write", "context.read", "media"],
      reply:
        "I created a new Project scope and loaded the Project creation tools. Next I would ask for audience, offer, source material, voice constraints, and deliverable counts.",
      action,
    };
  }

  if (includesAny(message, ["context", "audience", "voice", "company profile", "global profile", "seo", "discoverability"])) {
    return {
      intent: "context_hub_query",
      loadedToolBundles: ["base", "context.read"],
      reply: `I loaded the Context Hub read tools for ${store.site.name}. The Hub currently has ${store.contextProfiles.length} context profiles and ${store.knowledgeBaseFiles.length} indexed files.`,
      highlights: store.contextProfiles.slice(0, 3),
    };
  }

  if (includesAny(message, ["content", "approve", "approval", "review", "timeline", "post", "email", "article"])) {
    const groups = store.contentGroups.map((group) => ({
      ...group,
      items: store.contentItems.filter((item) => group.itemIds.includes(item.id)),
    }));

    return {
      intent: "content_review",
      loadedToolBundles: ["base", "content.read", "content.write"],
      reply: `I loaded content review tools. There ${groups.length === 1 ? "is" : "are"} ${groups.length} content group${groups.length === 1 ? "" : "s"} available for review.`,
      highlights: groups,
    };
  }

  if (includesAny(message, ["media", "image", "asset", "gallery", "video"])) {
    return {
      intent: "media",
      loadedToolBundles: ["base", "media"],
      reply: `I loaded Media Gallery tools. There are ${store.mediaAssets.length} assets in this Site library.`,
      highlights: store.mediaAssets.slice(0, 6),
    };
  }

  if (input.selectedProjectId || includesAny(message, ["project", "scope", "deliverable"])) {
    const project =
      store.projects.find((item) => item.id === input.selectedProjectId) ?? store.projects[0];
    return {
      intent: "existing_project_qa",
      loadedToolBundles: ["base", "project.read"],
      reply: project
        ? `${project.name} is ${project.state.replaceAll("_", " ")}. It has ${project.documents.length} scope documents, ${project.mediaIds.length} media assets, and deliverables for ${project.deliverables.facebookCount} Facebook, ${project.deliverables.webCount} web, and ${project.deliverables.emailCount} email items.`
        : "I loaded Project read tools, but I need a selected Project to answer precisely.",
      highlights: project,
    };
  }

  return {
    intent: "general_chat",
    loadedToolBundles: ["base"],
    reply:
      "I can help create Projects, query the Site Context Hub, review generated content, manage media, or explain the current workspace. Tell me what you want to work on and I will load the smallest useful toolset.",
  };
};
