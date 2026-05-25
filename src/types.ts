export type DocumentState =
  | "empty"
  | "in_progress"
  | "awaiting_approval"
  | "approved"
  | "rejected";

export type ContextProfileType =
  | "audience"
  | "product_service"
  | "service"
  | "deep_research"
  | "industry"
  | "case_study";

export type ContentItemType = "social" | "email" | "web";
export type ContentStatus =
  | "draft"
  | "need_revision"
  | "pending"
  | "scheduled"
  | "approved"
  | "rejected"
  | "live"
  | "published"
  | "failed";
export type ShareState = "private" | "site" | "public";
export type RiskLevel = "low" | "medium" | "high";
export type ActionSource = "ui" | "chat";
export type UserRole =
  | "super_admin"
  | "site_admin"
  | "project_admin"
  | "project_manager"
  | "reviewer";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarInitials: string;
}

export interface Team {
  id: string;
  name: string;
  plan: string;
}

export interface Site {
  id: string;
  teamId: string;
  name: string;
  domain: string;
}

export interface ProjectDocument {
  id: string;
  type: "overview" | "voice" | "designs" | "context" | "sources" | "deliverables";
  title: string;
  body: string;
  state: DocumentState;
  version: number;
  lastEditedBy: string;
  updatedAt: string;
  sourceReferences: string[];
  approval?: {
    approvedBy: string;
    approvedAt: string;
  };
  rejectionReason?: string;
}

export interface ProjectWorkLog {
  id: string;
  type: "sources" | "deliverables" | "context";
  requestedBy: string;
  request: string;
  response: string;
  createdAt: string;
}

export interface Deliverables {
  facebookCount: number;
  webCount: number;
  emailCount: number;
  scheduleRange: string;
  cadence: string;
  destinationAccounts: string[];
  notes: string;
}

export interface Project {
  id: string;
  siteId: string;
  name: string;
  ownerId: string;
  reviewerId?: string;
  modifiedAt: string;
  summary: string;
  documents: ProjectDocument[];
  workLogs: ProjectWorkLog[];
  deliverables: Deliverables;
  contextProfileIds: string[];
  mediaIds: string[];
  sourceFileIds: string[];
  shareState: ShareState;
  contentGroupId?: string;
}

export interface GlobalContextDocument {
  id: string;
  type: "global_profile" | "global_voice" | "global_seo";
  title: string;
  fields: Record<string, string | string[]>;
  updatedAt: string;
  updatedBy: string;
}

export interface ContextProfile {
  id: string;
  siteId: string;
  type: ContextProfileType;
  title: string;
  url?: string;
  summary: string;
  body: string;
  associatedProjectIds: string[];
  associatedMediaIds: string[];
  knowledgeBaseFileIds: string[];
  ownerId: string;
  createdAt: string;
  comments: string[];
  shareState: ShareState;
}

export interface KnowledgeBaseFile {
  id: string;
  siteId: string;
  fileName: string;
  fileType: string;
  description?: string;
  indexingStatus: "queued" | "indexed" | "failed";
  associatedContextProfileId?: string;
  associatedProjectId?: string;
  content: string;
  uploadedBy: string;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  siteId: string;
  title: string;
  fileType: string;
  mediaType: "image" | "video";
  thumbnail: string;
  tags: string[];
  folder: string;
  projectIds: string[];
  contentItemIds: string[];
  altText: string;
  notes: string;
  aiGenerated: boolean;
  createdAt: string;
}

export interface DesignFile {
  id: string;
  siteId: string;
  title: string;
  fileName: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContentGroup {
  id: string;
  siteId: string;
  projectId: string;
  name: string;
  status: "draft" | "in_review" | "scheduled" | "completed";
  scheduleRange: string;
  itemIds: string[];
  shareState: ShareState;
  modifiedAt: string;
}

export interface BaseContentItem {
  id: string;
  contentGroupId: string;
  projectId: string;
  type: ContentItemType;
  platform: string;
  status: ContentStatus;
  scheduledFor: string;
  mediaIds: string[];
  tags: string[];
  comments: string[];
  history: string[];
  shareState: ShareState;
}

export interface SocialContentItem extends BaseContentItem {
  type: "social";
  body: string;
  hashtags: string[];
}

export interface EmailContentItem extends BaseContentItem {
  type: "email";
  subject: string;
  preheader: string;
  body: string;
  recipientList: string;
  template: string;
  integrations: {
    salesforce: boolean;
    ga4: boolean;
  };
}

export interface WebContentItem extends BaseContentItem {
  type: "web";
  title: string;
  body: string;
  metaKeywords: string[];
  metaDescription: string;
  categories: string[];
}

export type ContentItem = SocialContentItem | EmailContentItem | WebContentItem;

export interface Integration {
  id: string;
  siteId: string;
  provider:
    | "Facebook"
    | "Instagram"
    | "LinkedIn"
    | "Twitter"
    | "TikTok"
    | "Bluesky"
    | "Threads"
    | "Mailchimp"
    | "HubSpot"
    | "WordPress"
    | "GA4";
  accountName: string;
  status: "connected" | "needs_attention" | "not_connected";
  lastSyncAt?: string;
}

export interface AuditEvent {
  id: string;
  userId: string;
  teamId: string;
  siteId: string;
  actionName: string;
  targetType: string;
  targetId: string;
  previousValueSummary: string;
  newValueSummary: string;
  confirmationState: "not_required" | "confirmed";
  source: ActionSource;
  timestamp: string;
  result: "success" | "failure";
}

export interface AppStore {
  currentUser: User;
  team: Team;
  site: Site;
  users: User[];
  projects: Project[];
  globalContextDocuments: GlobalContextDocument[];
  contextProfiles: ContextProfile[];
  knowledgeBaseFiles: KnowledgeBaseFile[];
  mediaAssets: MediaAsset[];
  designFiles: DesignFile[];
  contentGroups: ContentGroup[];
  contentItems: ContentItem[];
  integrations: Integration[];
  auditEvents: AuditEvent[];
}

export interface ActionRequest {
  source: ActionSource;
  confirmed?: boolean;
  payload: unknown;
}

export interface ActionPreview {
  requiresConfirmation: true;
  actionName: string;
  risk: RiskLevel;
  preview: string;
  targetType: string;
  targetId: string;
}

export interface ActionSuccess<T = unknown> {
  requiresConfirmation: false;
  actionName: string;
  risk: RiskLevel;
  message: string;
  data: T;
  auditEvent?: AuditEvent;
}

export type ActionResult<T = unknown> = ActionPreview | ActionSuccess<T>;
