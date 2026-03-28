-- Phase 1: Core tables for Slack data ingestion
-- Run this against your InsForge Postgres database

-- Workspaces (one per connected Slack team)
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_team_id text UNIQUE NOT NULL,
  team_name text NOT NULL,
  bot_token text NOT NULL,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Users (maps InsForge auth users to Slack identities)
CREATE TABLE users (
  id uuid PRIMARY KEY, -- matches InsForge auth user ID
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_user_id text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  avatar_url text DEFAULT '',
  slack_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slack_user_id)
);

-- Channels
CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_channel_id text NOT NULL,
  name text NOT NULL,
  topic text,
  member_count int DEFAULT 0,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slack_channel_id)
);

CREATE INDEX idx_channels_workspace ON channels(workspace_id);

-- Messages
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  slack_ts text NOT NULL,
  author_slack_id text NOT NULL,
  author_name text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  thread_ts text,
  reply_count int NOT NULL DEFAULT 0,
  reaction_count int NOT NULL DEFAULT 0,
  posted_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, channel_id, slack_ts)
);

CREATE INDEX idx_messages_channel_posted ON messages(channel_id, posted_at DESC);
CREATE INDEX idx_messages_workspace_posted ON messages(workspace_id, posted_at DESC);

-- Row Level Security
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Users can read their own workspace data
CREATE POLICY "users_read_own" ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "users_read_workspace" ON workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "channels_read_workspace" ON channels
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "messages_read_workspace" ON messages
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  );
