-- Moxio initial PostgreSQL schema.
--
-- Database:
--   DB_HOST=localhost
--   DB_PORT=5432
--   DB_USER=postgres
--   DB_PASSWORD=postgres
--   DB_NAME=moxio
--
-- Create the database separately before running this migration:
--   CREATE DATABASE moxio;
--
-- Public ids:
--   Every table has an auto-incrementing numeric primary key named id.
--   Every table also has a 12-character public id column named after the
--   table/entity, for example users.user_id and projects.project_id.
--   Foreign keys use these public ids instead of the numeric row id.
--
--   The application should generate these public ids with nanoid:
--
--     import { customAlphabet } from 'nanoid';
--
--     const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
--
--     export function generateId() {
--       return customAlphabet(alphabet, 12)();
--     }
--
--   This migration validates the 12-character alphanumeric format, but it does
--   not add database defaults so the app owns id generation consistently.

BEGIN;

CREATE TYPE project_state AS ENUM (
  'empty',
  'in_progress',
  'awaiting_approval',
  'approved',
  'completed',
  'rejected',
  'archived'
);
CREATE TYPE sites_doc_type AS ENUM (
  'global_profile',
  'global_voice',
  'global_seo'
);
CREATE TYPE project_scope_log_type AS ENUM ('sources', 'deliverables');
CREATE TYPE share_state AS ENUM ('private', 'site', 'public');
CREATE TYPE asset_status AS ENUM ('pending_approval', 'approved', 'rejected', 'archived');
CREATE TYPE indexing_status AS ENUM ('queued', 'indexed', 'failed');
CREATE TYPE media_type AS ENUM ('image', 'video');
CREATE TYPE contents_group_status AS ENUM ('draft', 'in_review', 'scheduled', 'completed');
CREATE TYPE content_type AS ENUM ('social', 'email', 'web');
CREATE TYPE content_status AS ENUM (
  'draft',
  'need_revision',
  'pending',
  'scheduled',
  'approved',
  'rejected',
  'live',
  'published',
  'failed'
);
CREATE TYPE channel_status AS ENUM ('connected', 'needs_attention', 'not_connected');
CREATE TYPE action_source AS ENUM ('ui', 'chat', 'share');
CREATE TYPE action_risk AS ENUM ('low', 'medium', 'high');
CREATE TYPE confirmation_state AS ENUM ('not_required', 'confirmed');
CREATE TYPE action_result AS ENUM ('success', 'failure');
CREATE TYPE chat_role AS ENUM ('system', 'user', 'assistant', 'tool');
CREATE TYPE ai_job_status AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE generation_kind AS ENUM ('social_media_asset', 'infographic', 'image_edit');
CREATE TYPE billing_interval AS ENUM ('monthly', 'annual');
CREATE TYPE permission_scope AS ENUM ('team', 'site', 'project');
CREATE TYPE permission_role AS ENUM (
  'super_admin',
  'site_admin',
  'project_admin',
  'project_manager',
  'reviewer'
);
CREATE TYPE reviewer_state AS ENUM ('invited', 'active', 'revoked', 'expired');
CREATE TYPE reviewer_token_state AS ENUM ('active', 'used', 'expired', 'revoked');
CREATE TYPE project_context_selection_state AS ENUM (
  'pending_user_input',
  'agent_working',
  'overlay_updated',
  'cancelled',
  'failed'
);

CREATE TABLE plans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id varchar(12) NOT NULL UNIQUE CHECK (plan_id ~ '^[0-9A-Za-z]{12}$'),
  code text NOT NULL UNIQUE CHECK (code <> ''),
  name text NOT NULL CHECK (name <> ''),
  description text NOT NULL DEFAULT '',
  channel_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  included_platforms text[] NOT NULL DEFAULT '{}'::text[],
  includes_ems boolean NOT NULL DEFAULT false,
  includes_cms boolean NOT NULL DEFAULT false,
  includes_ads boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(channel_scope) = 'object')
);

CREATE INDEX plans_included_platforms_idx ON plans USING gin(included_platforms);

CREATE TABLE plans_prices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plans_price_id varchar(12) NOT NULL UNIQUE CHECK (plans_price_id ~ '^[0-9A-Za-z]{12}$'),
  plan_id varchar(12) NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
  interval billing_interval NOT NULL,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  external_price_id text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, interval, currency)
);

CREATE INDEX plans_prices_plan_active_idx ON plans_prices(plan_id, is_active);

CREATE TABLE teams (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id varchar(12) NOT NULL UNIQUE CHECK (team_id ~ '^[0-9A-Za-z]{12}$'),
  name text NOT NULL CHECK (name <> ''),
  plan text NOT NULL DEFAULT 'AI Workspace',
  plan_id varchar(12) REFERENCES plans(plan_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id varchar(12) NOT NULL UNIQUE CHECK (user_id ~ '^[0-9A-Za-z]{12}$'),
  name text NOT NULL CHECK (name <> ''),
  email text NOT NULL CHECK (email <> ''),
  avatar_initials varchar(4) NOT NULL DEFAULT '',
  avatar_file_name text NOT NULL DEFAULT '',
  avatar_storage_key text NOT NULL DEFAULT '',
  avatar_crop jsonb NOT NULL DEFAULT '{}'::jsonb,
  totp_enabled boolean NOT NULL DEFAULT false,
  totp_secret_encrypted text NOT NULL DEFAULT '',
  totp_pending_secret_encrypted text NOT NULL DEFAULT '',
  totp_pending_created_at timestamptz,
  totp_enabled_at timestamptz,
  totp_last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE users_team (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  users_team_id varchar(12) NOT NULL UNIQUE CHECK (users_team_id ~ '^[0-9A-Za-z]{12}$'),
  team_id varchar(12) NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  user_id varchar(12) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

CREATE TABLE sites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id varchar(12) NOT NULL UNIQUE CHECK (site_id ~ '^[0-9A-Za-z]{12}$'),
  team_id varchar(12) NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  domain text NOT NULL CHECK (domain <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, domain)
);

CREATE TABLE users_site (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  users_site_id varchar(12) NOT NULL UNIQUE CHECK (users_site_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  user_id varchar(12) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, user_id)
);

CREATE INDEX users_team_user_id_idx ON users_team(user_id);
CREATE INDEX users_site_user_id_idx ON users_site(user_id);

CREATE FUNCTION prevent_duplicate_team_and_site_membership()
RETURNS trigger AS $$
DECLARE
  resolved_team_id varchar(12);
BEGIN
  IF TG_TABLE_NAME = 'users_team' THEN
    IF EXISTS (
      SELECT 1
      FROM users_site su
      JOIN sites s ON s.site_id = su.site_id
      WHERE s.team_id = NEW.team_id
        AND su.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'User cannot be both a team member and a direct site member in the same team';
    END IF;
  ELSE
    SELECT s.team_id INTO resolved_team_id
    FROM sites s
    WHERE s.site_id = NEW.site_id;

    IF EXISTS (
      SELECT 1
      FROM users_team tu
      WHERE tu.team_id = resolved_team_id
        AND tu.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'User cannot be both a team member and a direct site member in the same team';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_users_team_with_users_site
BEFORE INSERT OR UPDATE OF team_id, user_id ON users_team
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_team_and_site_membership();

CREATE TRIGGER prevent_users_site_with_users_team
BEFORE INSERT OR UPDATE OF site_id, user_id ON users_site
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_team_and_site_membership();

CREATE TABLE permissions_grants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  permissions_grant_id varchar(12) NOT NULL UNIQUE CHECK (permissions_grant_id ~ '^[0-9A-Za-z]{12}$'),
  scope permission_scope NOT NULL,
  scope_id varchar(12) NOT NULL CHECK (scope_id ~ '^[0-9A-Za-z]{12}$'),
  user_id varchar(12) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role permission_role NOT NULL,
  granted_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX permissions_grants_active_unique_idx
  ON permissions_grants(scope, scope_id, user_id, role)
  WHERE revoked_at IS NULL;
CREATE INDEX permissions_grants_user_role_idx ON permissions_grants(user_id, role);
CREATE INDEX permissions_grants_scope_role_idx ON permissions_grants(scope, scope_id, role);

CREATE TABLE projects (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id varchar(12) NOT NULL UNIQUE CHECK (project_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  owner_user_id varchar(12) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  project_admin_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  reviewer_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  name text NOT NULL CHECK (name <> ''),
  state project_state NOT NULL DEFAULT 'empty',
  share_state share_state NOT NULL DEFAULT 'private',
  summary text NOT NULL DEFAULT '',
  facebook_count integer NOT NULL DEFAULT 0 CHECK (facebook_count >= 0),
  web_count integer NOT NULL DEFAULT 0 CHECK (web_count >= 0),
  email_count integer NOT NULL DEFAULT 0 CHECK (email_count >= 0),
  schedule_range text NOT NULL DEFAULT '',
  cadence text NOT NULL DEFAULT '',
  destination_accounts text[] NOT NULL DEFAULT '{}'::text[],
  deliverable_notes text NOT NULL DEFAULT '',
  docs jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  product_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  service_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  study_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  research_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  industry_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  asset_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (jsonb_typeof(docs) = 'object')
);

CREATE INDEX projects_owner_user_id_idx ON projects(owner_user_id);
CREATE INDEX projects_project_admin_user_id_idx ON projects(project_admin_user_id)
  WHERE project_admin_user_id IS NOT NULL;
CREATE INDEX projects_site_state_idx ON projects(site_id, state);
CREATE INDEX projects_site_share_state_idx ON projects(site_id, share_state);
CREATE INDEX projects_site_updated_at_idx ON projects(site_id, updated_at DESC);
CREATE INDEX projects_site_name_idx ON projects(site_id, lower(name));
CREATE INDEX projects_audience_ids_idx ON projects USING gin(audience_ids);
CREATE INDEX projects_product_ids_idx ON projects USING gin(product_ids);
CREATE INDEX projects_service_ids_idx ON projects USING gin(service_ids);
CREATE INDEX projects_study_ids_idx ON projects USING gin(study_ids);
CREATE INDEX projects_research_ids_idx ON projects USING gin(research_ids);
CREATE INDEX projects_industry_ids_idx ON projects USING gin(industry_ids);
CREATE INDEX projects_asset_ids_idx ON projects USING gin(asset_ids);

CREATE TABLE reviewers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reviewer_id varchar(12) NOT NULL UNIQUE CHECK (reviewer_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  project_id varchar(12) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email <> ''),
  name text NOT NULL DEFAULT '',
  status reviewer_state NOT NULL DEFAULT 'invited',
  invited_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  access_notes text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX reviewers_project_email_idx ON reviewers(project_id, lower(email));
CREATE INDEX reviewers_site_status_idx ON reviewers(site_id, status);
CREATE INDEX reviewers_project_status_idx ON reviewers(project_id, status);

CREATE TABLE reviewers_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reviewers_token_id varchar(12) NOT NULL UNIQUE CHECK (reviewers_token_id ~ '^[0-9A-Za-z]{12}$'),
  reviewer_id varchar(12) NOT NULL REFERENCES reviewers(reviewer_id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash <> ''),
  otp_hash text NOT NULL CHECK (otp_hash <> ''),
  status reviewer_token_state NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reviewers_tokens_reviewer_idx
  ON reviewers_tokens(reviewer_id, status, expires_at DESC);
CREATE INDEX reviewers_tokens_token_hash_idx ON reviewers_tokens(token_hash)
  WHERE status = 'active';
CREATE INDEX reviewers_tokens_otp_hash_idx ON reviewers_tokens(otp_hash)
  WHERE status = 'active';

CREATE TABLE projects_scope_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  projects_scope_log_id varchar(12) NOT NULL UNIQUE CHECK (projects_scope_log_id ~ '^[0-9A-Za-z]{12}$'),
  project_id varchar(12) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  actor_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  type project_scope_log_type NOT NULL,
  request text NOT NULL DEFAULT '',
  response text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX projects_scope_logs_project_type_created_at_idx
  ON projects_scope_logs(project_id, type, created_at DESC);
CREATE INDEX projects_scope_logs_actor_created_at_idx
  ON projects_scope_logs(actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE TABLE sites_docs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sites_doc_id varchar(12) NOT NULL UNIQUE CHECK (sites_doc_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  type sites_doc_type NOT NULL,
  file_name text NOT NULL CHECK (file_name <> ''),
  body text NOT NULL DEFAULT '',
  updated_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, type)
);

CREATE TABLE profiles_audiences (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audience_id varchar(12) NOT NULL UNIQUE CHECK (audience_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  summary text NOT NULL DEFAULT '',
  pain text NOT NULL DEFAULT '',
  solutions text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  industry_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  asset_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  owner_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  share_state share_state NOT NULL DEFAULT 'private',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX profiles_audiences_site_name_idx ON profiles_audiences(site_id, name);
CREATE INDEX profiles_audiences_site_share_state_idx ON profiles_audiences(site_id, share_state);
CREATE INDEX profiles_audiences_site_created_at_idx ON profiles_audiences(site_id, created_at DESC);
CREATE INDEX profiles_audiences_site_sort_idx ON profiles_audiences(site_id, sort_order, name);
CREATE INDEX profiles_audiences_site_archived_at_idx ON profiles_audiences(site_id, archived_at);

CREATE TABLE profiles_products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id varchar(12) NOT NULL UNIQUE CHECK (product_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  summary text NOT NULL DEFAULT '',
  url text,
  instructions text NOT NULL DEFAULT '',
  audience_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  industry_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  asset_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  owner_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  share_state share_state NOT NULL DEFAULT 'private',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX profiles_products_site_name_idx ON profiles_products(site_id, name);
CREATE INDEX profiles_products_site_share_state_idx ON profiles_products(site_id, share_state);
CREATE INDEX profiles_products_site_created_at_idx ON profiles_products(site_id, created_at DESC);
CREATE INDEX profiles_products_site_sort_idx ON profiles_products(site_id, sort_order, name);
CREATE INDEX profiles_products_site_archived_at_idx ON profiles_products(site_id, archived_at);

CREATE TABLE profiles_services (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id varchar(12) NOT NULL UNIQUE CHECK (service_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  summary text NOT NULL DEFAULT '',
  url text,
  instructions text NOT NULL DEFAULT '',
  audience_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  industry_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  asset_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  owner_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  share_state share_state NOT NULL DEFAULT 'private',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX profiles_services_site_name_idx ON profiles_services(site_id, name);
CREATE INDEX profiles_services_site_share_state_idx ON profiles_services(site_id, share_state);
CREATE INDEX profiles_services_site_created_at_idx ON profiles_services(site_id, created_at DESC);
CREATE INDEX profiles_services_site_sort_idx ON profiles_services(site_id, sort_order, name);
CREATE INDEX profiles_services_site_archived_at_idx ON profiles_services(site_id, archived_at);

CREATE TABLE profiles_studies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  study_id varchar(12) NOT NULL UNIQUE CHECK (study_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  summary text NOT NULL DEFAULT '',
  pain text NOT NULL DEFAULT '',
  solutions text NOT NULL DEFAULT '',
  service text NOT NULL DEFAULT '',
  url text,
  industry_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  asset_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  owner_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  share_state share_state NOT NULL DEFAULT 'private',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX profiles_studies_site_name_idx ON profiles_studies(site_id, name);
CREATE INDEX profiles_studies_site_share_state_idx ON profiles_studies(site_id, share_state);
CREATE INDEX profiles_studies_site_created_at_idx ON profiles_studies(site_id, created_at DESC);
CREATE INDEX profiles_studies_site_sort_idx ON profiles_studies(site_id, sort_order, name);
CREATE INDEX profiles_studies_site_archived_at_idx ON profiles_studies(site_id, archived_at);

CREATE TABLE profiles_research (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  research_id varchar(12) NOT NULL UNIQUE CHECK (research_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  url text,
  asset_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  owner_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  share_state share_state NOT NULL DEFAULT 'private',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX profiles_research_site_name_idx ON profiles_research(site_id, name);
CREATE INDEX profiles_research_site_share_state_idx ON profiles_research(site_id, share_state);
CREATE INDEX profiles_research_site_created_at_idx ON profiles_research(site_id, created_at DESC);
CREATE INDEX profiles_research_site_sort_idx ON profiles_research(site_id, sort_order, name);
CREATE INDEX profiles_research_site_archived_at_idx ON profiles_research(site_id, archived_at);

CREATE TABLE profiles_industries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  industry_id varchar(12) NOT NULL UNIQUE CHECK (industry_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  summary text NOT NULL DEFAULT '',
  trends text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT '',
  publications text NOT NULL DEFAULT '',
  experts text NOT NULL DEFAULT '',
  product_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  study_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  asset_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  owner_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  share_state share_state NOT NULL DEFAULT 'private',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX profiles_industries_site_name_idx ON profiles_industries(site_id, name);
CREATE INDEX profiles_industries_site_share_state_idx ON profiles_industries(site_id, share_state);
CREATE INDEX profiles_industries_site_created_at_idx ON profiles_industries(site_id, created_at DESC);
CREATE INDEX profiles_industries_site_sort_idx ON profiles_industries(site_id, sort_order, name);
CREATE INDEX profiles_industries_site_archived_at_idx ON profiles_industries(site_id, archived_at);

CREATE TABLE assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id varchar(12) NOT NULL UNIQUE CHECK (asset_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (title <> ''),
  media_type media_type NOT NULL,
  status asset_status NOT NULL DEFAULT 'pending_approval',
  file_ext text NOT NULL CHECK (file_ext <> ''),
  mime_type text NOT NULL CHECK (mime_type <> ''),
  original_file_name text NOT NULL DEFAULT '',
  storage_key text NOT NULL DEFAULT '',
  file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  width integer CHECK (width IS NULL OR width >= 0),
  height integer CHECK (height IS NULL OR height >= 0),
  uploaded_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  thumbnail text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}'::text[],
  folder text NOT NULL DEFAULT '',
  alt_text text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  ai_generated boolean NOT NULL DEFAULT false,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(validation) = 'object')
);

CREATE INDEX assets_folder_idx ON assets(site_id, folder);
CREATE INDEX assets_site_status_idx ON assets(site_id, status);
CREATE INDEX assets_site_media_type_idx ON assets(site_id, media_type);
CREATE INDEX assets_site_file_ext_idx ON assets(site_id, file_ext);
CREATE INDEX assets_site_created_at_idx ON assets(site_id, created_at DESC);
CREATE INDEX assets_site_title_idx ON assets(site_id, lower(title));
CREATE INDEX assets_tags_idx ON assets USING gin(tags);
CREATE INDEX assets_search_idx ON assets USING gin (
  to_tsvector(
    'english',
    title || ' ' || notes || ' ' || folder || ' ' || original_file_name || ' ' ||
    alt_text || ' ' || array_to_string(tags, ' ')
  )
);

CREATE TABLE knowledge (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  knowledge_id varchar(12) NOT NULL UNIQUE CHECK (knowledge_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (title <> ''),
  file_ext text NOT NULL CHECK (file_ext <> ''),
  mime_type text NOT NULL CHECK (mime_type <> ''),
  original_file_name text NOT NULL DEFAULT '',
  storage_key text NOT NULL DEFAULT '',
  file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  indexing_status indexing_status NOT NULL DEFAULT 'queued',
  uploaded_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'chat')),
  source_chat_id varchar(12) CHECK (source_chat_id IS NULL OR source_chat_id ~ '^[0-9A-Za-z]{12}$'),
  source_message_id varchar(12) CHECK (source_message_id IS NULL OR source_message_id ~ '^[0-9A-Za-z]{12}$'),
  content text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}'::text[],
  folder text NOT NULL DEFAULT '',
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(validation) = 'object')
);

CREATE INDEX knowledge_site_indexing_status_idx ON knowledge(site_id, indexing_status);
CREATE INDEX knowledge_site_created_at_idx ON knowledge(site_id, created_at DESC);
CREATE INDEX knowledge_site_title_idx ON knowledge(site_id, lower(title));
CREATE INDEX knowledge_source_idx ON knowledge(site_id, source, created_at DESC);
CREATE INDEX knowledge_source_chat_idx ON knowledge(source_chat_id)
  WHERE source_chat_id IS NOT NULL;
CREATE INDEX knowledge_tags_idx ON knowledge USING gin(tags);
CREATE INDEX knowledge_search_idx ON knowledge USING gin (
  to_tsvector(
    'english',
    title || ' ' || original_file_name || ' ' || folder || ' ' ||
    content || ' ' || array_to_string(tags, ' ')
  )
);

CREATE TABLE designs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  design_id varchar(12) NOT NULL UNIQUE CHECK (design_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (title <> ''),
  file_name text NOT NULL CHECK (file_name <> ''),
  description text NOT NULL DEFAULT '',
  design_type text NOT NULL DEFAULT 'markdown',
  status asset_status NOT NULL DEFAULT 'approved',
  content text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}'::text[],
  folder text NOT NULL DEFAULT '',
  created_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX designs_site_updated_at_idx ON designs(site_id, updated_at DESC);
CREATE INDEX designs_site_title_idx ON designs(site_id, lower(title));
CREATE INDEX designs_site_status_idx ON designs(site_id, status);
CREATE INDEX designs_site_type_idx ON designs(site_id, design_type);
CREATE INDEX designs_site_archived_at_idx ON designs(site_id, archived_at);
CREATE INDEX designs_tags_idx ON designs USING gin(tags);
CREATE INDEX designs_search_idx ON designs USING gin (
  to_tsvector(
    'english',
    title || ' ' || file_name || ' ' || description || ' ' ||
    folder || ' ' || content || ' ' || array_to_string(tags, ' ')
  )
);

CREATE TABLE contents_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contents_group_id varchar(12) NOT NULL UNIQUE CHECK (contents_group_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  project_id varchar(12) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  status contents_group_status NOT NULL DEFAULT 'draft',
  schedule_range text NOT NULL DEFAULT '',
  share_state share_state NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contents_groups_site_status_idx ON contents_groups(site_id, status);
CREATE INDEX contents_groups_project_status_idx ON contents_groups(project_id, status);
CREATE INDEX contents_groups_site_created_at_idx ON contents_groups(site_id, created_at DESC);
CREATE INDEX contents_groups_site_name_idx ON contents_groups(site_id, lower(name));
CREATE INDEX contents_groups_site_share_state_idx ON contents_groups(site_id, share_state);

CREATE TABLE contents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_id varchar(12) NOT NULL UNIQUE CHECK (content_id ~ '^[0-9A-Za-z]{12}$'),
  contents_group_id varchar(12) NOT NULL REFERENCES contents_groups(contents_group_id) ON DELETE CASCADE,
  type content_type NOT NULL,
  platform text NOT NULL DEFAULT '',
  status content_status NOT NULL DEFAULT 'draft',
  share_state share_state NOT NULL DEFAULT 'private',
  scheduled_for timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  asset_ids varchar(12)[] NOT NULL DEFAULT '{}'::varchar(12)[],
  content_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(content_data) = 'object')
);

CREATE INDEX contents_group_sort_idx ON contents(contents_group_id, sort_order);
CREATE INDEX contents_status_idx ON contents(status);
CREATE INDEX contents_share_state_idx ON contents(share_state);
CREATE INDEX contents_scheduled_for_idx ON contents(scheduled_for);
CREATE INDEX contents_type_status_scheduled_idx ON contents(type, status, scheduled_for);
CREATE INDEX contents_tags_idx ON contents USING gin(tags);
CREATE INDEX contents_asset_ids_idx ON contents USING gin(asset_ids);
CREATE INDEX contents_content_data_idx ON contents USING gin(content_data);

CREATE TABLE comments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comment_id varchar(12) NOT NULL UNIQUE CHECK (comment_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  project_id varchar(12) REFERENCES projects(project_id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type <> ''),
  target_id varchar(12) NOT NULL CHECK (target_id ~ '^[0-9A-Za-z]{12}$'),
  user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  reviewer_id varchar(12) REFERENCES reviewers(reviewer_id) ON DELETE SET NULL,
  guest_name text NOT NULL DEFAULT '',
  guest_email text NOT NULL DEFAULT '',
  visibility share_state NOT NULL DEFAULT 'site',
  body text NOT NULL CHECK (body <> ''),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object'),
  CHECK (
    user_id IS NOT NULL
    OR reviewer_id IS NOT NULL
    OR visibility <> 'public'
    OR (guest_name <> '' AND guest_email <> '')
  )
);

CREATE INDEX comments_site_created_at_idx ON comments(site_id, created_at DESC);
CREATE INDEX comments_project_created_at_idx ON comments(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX comments_target_idx ON comments(target_type, target_id, created_at DESC);
CREATE INDEX comments_public_target_idx ON comments(target_type, target_id, created_at DESC)
  WHERE visibility = 'public';
CREATE INDEX comments_reviewer_idx ON comments(reviewer_id, created_at DESC)
  WHERE reviewer_id IS NOT NULL;

CREATE TABLE actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action_id varchar(12) NOT NULL UNIQUE CHECK (action_id ~ '^[0-9A-Za-z]{12}$'),
  team_id varchar(12) REFERENCES teams(team_id) ON DELETE SET NULL,
  site_id varchar(12) REFERENCES sites(site_id) ON DELETE SET NULL,
  actor_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  actor_reviewer_id varchar(12) REFERENCES reviewers(reviewer_id) ON DELETE SET NULL,
  recipient_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  recipient_reviewer_id varchar(12) REFERENCES reviewers(reviewer_id) ON DELETE SET NULL,
  action_name text NOT NULL CHECK (action_name <> ''),
  target_type text NOT NULL CHECK (target_type <> ''),
  target_id text NOT NULL DEFAULT '',
  target_name text NOT NULL DEFAULT '',
  previous_value_summary text NOT NULL DEFAULT '',
  new_value_summary text NOT NULL DEFAULT '',
  risk action_risk NOT NULL DEFAULT 'low',
  confirmation_state confirmation_state NOT NULL DEFAULT 'not_required',
  source action_source NOT NULL,
  result action_result NOT NULL DEFAULT 'success',
  error_message text,
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX actions_site_created_at_idx ON actions(site_id, created_at DESC);
CREATE INDEX actions_actor_created_at_idx ON actions(actor_user_id, created_at DESC);
CREATE INDEX actions_actor_reviewer_idx ON actions(actor_reviewer_id, created_at DESC)
  WHERE actor_reviewer_id IS NOT NULL;
CREATE INDEX actions_recipient_read_idx ON actions(recipient_user_id, read_at, created_at DESC);
CREATE INDEX actions_recipient_reviewer_idx ON actions(recipient_reviewer_id, created_at DESC)
  WHERE recipient_reviewer_id IS NOT NULL;
CREATE INDEX actions_target_idx ON actions(target_type, target_id);

CREATE TABLE channels (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id varchar(12) NOT NULL UNIQUE CHECK (channel_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  service text NOT NULL CHECK (service <> ''),
  provider text NOT NULL CHECK (provider <> ''),
  account_name text NOT NULL CHECK (account_name <> ''),
  broker text NOT NULL DEFAULT 'zernio' CHECK (broker <> ''),
  platform_key text NOT NULL DEFAULT '',
  external_profile_id text NOT NULL DEFAULT '',
  external_connection_id text NOT NULL DEFAULT '',
  status channel_status NOT NULL DEFAULT 'not_connected',
  last_sync_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, broker, service, provider, account_name),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX channels_site_status_idx ON channels(site_id, status);
CREATE INDEX channels_broker_platform_idx ON channels(broker, platform_key);
CREATE INDEX channels_external_profile_idx ON channels(broker, external_profile_id)
  WHERE external_profile_id <> '';
CREATE INDEX channels_external_connection_idx ON channels(broker, service, external_connection_id)
  WHERE external_connection_id <> '';

CREATE TABLE chats (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id varchar(12) NOT NULL UNIQUE CHECK (chat_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  reviewer_id varchar(12) REFERENCES reviewers(reviewer_id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  current_page text NOT NULL DEFAULT 'home',
  selected_project_id varchar(12) REFERENCES projects(project_id) ON DELETE SET NULL,
  selected_group_id varchar(12) REFERENCES contents_groups(contents_group_id) ON DELETE SET NULL,
  model text NOT NULL DEFAULT '',
  context_limit_tokens integer CHECK (context_limit_tokens IS NULL OR context_limit_tokens > 0),
  estimated_context_tokens integer NOT NULL DEFAULT 0 CHECK (estimated_context_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chats_site_user_idx ON chats(site_id, user_id);
CREATE INDEX chats_reviewer_idx ON chats(reviewer_id, updated_at DESC)
  WHERE reviewer_id IS NOT NULL;
CREATE INDEX chats_selected_project_idx ON chats(selected_project_id);
CREATE INDEX chats_selected_group_idx ON chats(selected_group_id);
CREATE INDEX chats_updated_at_idx ON chats(updated_at DESC);

CREATE TABLE chats_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chats_message_id varchar(12) NOT NULL UNIQUE CHECK (chats_message_id ~ '^[0-9A-Za-z]{12}$'),
  chat_id varchar(12) NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  role chat_role NOT NULL,
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_estimate integer NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chats_messages_chat_created_at_idx ON chats_messages(chat_id, created_at);
CREATE INDEX chats_messages_compaction_idx
  ON chats_messages(chat_id, created_at DESC)
  WHERE metadata ? 'compaction';

ALTER TABLE knowledge
  ADD CONSTRAINT knowledge_source_chat_fk
    FOREIGN KEY (source_chat_id) REFERENCES chats(chat_id) ON DELETE SET NULL,
  ADD CONSTRAINT knowledge_source_message_fk
    FOREIGN KEY (source_message_id) REFERENCES chats_messages(chats_message_id) ON DELETE SET NULL;

CREATE TABLE knowledge_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  knowledge_profile_id varchar(12) NOT NULL UNIQUE CHECK (knowledge_profile_id ~ '^[0-9A-Za-z]{12}$'),
  knowledge_id varchar(12) NOT NULL REFERENCES knowledge(knowledge_id) ON DELETE CASCADE,
  project_id varchar(12) REFERENCES projects(project_id) ON DELETE SET NULL,
  profile_type text NOT NULL CHECK (profile_type IN ('audience', 'product', 'service', 'study', 'research', 'industry')),
  profile_id varchar(12) NOT NULL CHECK (profile_id ~ '^[0-9A-Za-z]{12}$'),
  created_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  chat_id varchar(12) REFERENCES chats(chat_id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX knowledge_profiles_knowledge_idx ON knowledge_profiles(knowledge_id);
CREATE INDEX knowledge_profiles_project_idx ON knowledge_profiles(project_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX knowledge_profiles_profile_idx ON knowledge_profiles(profile_type, profile_id);
CREATE INDEX knowledge_profiles_chat_idx ON knowledge_profiles(chat_id)
  WHERE chat_id IS NOT NULL;

CREATE TABLE projects_context_selections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  projects_context_selection_id varchar(12) NOT NULL UNIQUE CHECK (projects_context_selection_id ~ '^[0-9A-Za-z]{12}$'),
  project_id varchar(12) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  selected_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  chat_id varchar(12) REFERENCES chats(chat_id) ON DELETE SET NULL,
  message_id varchar(12) REFERENCES chats_messages(chats_message_id) ON DELETE SET NULL,
  profile_type text NOT NULL CHECK (profile_type IN ('audience', 'product', 'service', 'study', 'research', 'industry')),
  profile_id varchar(12) NOT NULL CHECK (profile_id ~ '^[0-9A-Za-z]{12}$'),
  knowledge_id varchar(12) REFERENCES knowledge(knowledge_id) ON DELETE SET NULL,
  state project_context_selection_state NOT NULL DEFAULT 'pending_user_input',
  attachment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_instruction text NOT NULL DEFAULT '',
  overlay_change_summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (jsonb_typeof(attachment_metadata) = 'object')
);

CREATE INDEX projects_context_selections_project_state_idx
  ON projects_context_selections(project_id, state, created_at DESC);
CREATE INDEX projects_context_selections_chat_idx ON projects_context_selections(chat_id)
  WHERE chat_id IS NOT NULL;
CREATE INDEX projects_context_selections_profile_idx
  ON projects_context_selections(profile_type, profile_id);
CREATE INDEX projects_context_selections_knowledge_idx ON projects_context_selections(knowledge_id)
  WHERE knowledge_id IS NOT NULL;

CREATE TABLE brands (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id varchar(12) NOT NULL UNIQUE CHECK (brand_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Site and Brand',
  logo_asset_id varchar(12) REFERENCES assets(asset_id) ON DELETE SET NULL,
  logo_crop jsonb NOT NULL DEFAULT '{}'::jsonb,
  colors jsonb NOT NULL DEFAULT '[]'::jsonb,
  typography jsonb NOT NULL DEFAULT '{}'::jsonb,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id),
  CHECK (jsonb_typeof(colors) = 'array'),
  CHECK (jsonb_typeof(logo_crop) = 'object'),
  CHECK (jsonb_typeof(typography) = 'object'),
  CHECK (jsonb_typeof(files) = 'array'),
  CHECK (jsonb_typeof(notes) = 'object')
);

CREATE INDEX brands_logo_asset_idx ON brands(logo_asset_id)
  WHERE logo_asset_id IS NOT NULL;

CREATE TABLE image_edit_templates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_edit_template_id varchar(12) NOT NULL UNIQUE CHECK (image_edit_template_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) REFERENCES sites(site_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (title <> ''),
  description text NOT NULL DEFAULT '',
  canvas_width integer NOT NULL CHECK (canvas_width > 0),
  canvas_height integer NOT NULL CHECK (canvas_height > 0),
  layers jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (jsonb_typeof(layers) = 'object')
);

CREATE INDEX image_edit_templates_site_updated_at_idx
  ON image_edit_templates(site_id, updated_at DESC)
  WHERE site_id IS NOT NULL;
CREATE INDEX image_edit_templates_system_idx
  ON image_edit_templates(is_system, title)
  WHERE archived_at IS NULL;
CREATE INDEX image_edit_templates_archived_at_idx
  ON image_edit_templates(archived_at);

CREATE TABLE generations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generation_id varchar(12) NOT NULL UNIQUE CHECK (generation_id ~ '^[0-9A-Za-z]{12}$'),
  site_id varchar(12) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  requested_by_user_id varchar(12) REFERENCES users(user_id) ON DELETE SET NULL,
  kind generation_kind NOT NULL DEFAULT 'social_media_asset',
  prompt text NOT NULL DEFAULT '',
  format text NOT NULL DEFAULT '',
  style text NOT NULL DEFAULT '',
  credit_cost integer NOT NULL DEFAULT 0 CHECK (credit_cost >= 0),
  source_asset_id varchar(12) REFERENCES assets(asset_id) ON DELETE SET NULL,
  frame_asset_id varchar(12) REFERENCES assets(asset_id) ON DELETE SET NULL,
  logo_asset_id varchar(12) REFERENCES assets(asset_id) ON DELETE SET NULL,
  image_edit_template_id varchar(12) REFERENCES image_edit_templates(image_edit_template_id) ON DELETE SET NULL,
  canvas_width integer CHECK (canvas_width IS NULL OR canvas_width > 0),
  canvas_height integer CHECK (canvas_height IS NULL OR canvas_height > 0),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  status ai_job_status NOT NULL DEFAULT 'queued',
  result_asset_id varchar(12) REFERENCES assets(asset_id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (jsonb_typeof(input) = 'object')
);

CREATE INDEX generations_site_created_at_idx
  ON generations(site_id, created_at DESC);
CREATE INDEX generations_site_kind_created_at_idx
  ON generations(site_id, kind, created_at DESC);
CREATE INDEX generations_site_status_idx
  ON generations(site_id, status);
CREATE INDEX generations_source_asset_idx
  ON generations(source_asset_id)
  WHERE source_asset_id IS NOT NULL;
CREATE INDEX generations_frame_asset_idx
  ON generations(frame_asset_id)
  WHERE frame_asset_id IS NOT NULL;
CREATE INDEX generations_logo_asset_idx
  ON generations(logo_asset_id)
  WHERE logo_asset_id IS NOT NULL;
CREATE INDEX generations_template_idx
  ON generations(image_edit_template_id)
  WHERE image_edit_template_id IS NOT NULL;

COMMIT;
