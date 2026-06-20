CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  version integer NOT NULL DEFAULT 1,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY,
  name text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  initials text NOT NULL,
  job_title text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#6757d9',
  role_id text REFERENCES roles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id text REFERENCES roles(id),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL CHECK (type IN ('scrum','kanban','hybrid')),
  management text NOT NULL DEFAULT 'team' CHECK (management IN ('team','company')),
  color text NOT NULL,
  lead_id text REFERENCES users(id) ON DELETE SET NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS statuses (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  wip_limit integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sprints (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  goal text NOT NULL DEFAULT '',
  starts_on date,
  ends_on date,
  status text NOT NULL CHECK (status IN ('planned','active','completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS releases (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  release_date date,
  status text NOT NULL,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  notes text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS issues (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_key text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL,
  priority text NOT NULL,
  status_id text REFERENCES statuses(id),
  assignee_id text REFERENCES users(id) ON DELETE SET NULL,
  reporter_id text REFERENCES users(id) ON DELETE SET NULL,
  sprint_id text REFERENCES sprints(id) ON DELETE SET NULL,
  parent_id text REFERENCES issues(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  epic text NOT NULL DEFAULT '',
  points numeric NOT NULL DEFAULT 0,
  original_estimate integer NOT NULL DEFAULT 0,
  due_date date,
  rank numeric NOT NULL DEFAULT 999,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status_id);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_id);
CREATE INDEX IF NOT EXISTS idx_issues_sprint ON issues(sprint_id);
CREATE INDEX IF NOT EXISTS idx_issues_search ON issues USING gin (to_tsvector('portuguese', title || ' ' || description));

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id text NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label text NOT NULL,
  PRIMARY KEY (issue_id, label)
);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  issue_id text NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_id text REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worklogs (
  id text PRIMARY KEY,
  issue_id text NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  work_date date NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
