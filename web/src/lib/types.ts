export interface Workspace {
  id: string;
  slack_team_id: string;
  team_name: string;
  last_synced_at: string | null;
  created_at: string;
}

export interface User {
  id: string;
  workspace_id: string;
  slack_user_id: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
}

export interface Channel {
  id: string;
  workspace_id: string;
  slack_channel_id: string;
  name: string;
  topic: string | null;
  member_count: number;
  last_message_at: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  workspace_id: string;
  channel_id: string;
  slack_ts: string;
  author_slack_id: string;
  author_name: string;
  content: string;
  thread_ts: string | null;
  reply_count: number;
  reaction_count: number;
  posted_at: string;
  synced_at: string;
  channel_name?: string;
  relevance_score?: number | null;
  relevance_signals?: Record<string, number> | null;
  relevance_scored_at?: string | null;
}

export interface UserRule {
  id: string;
  user_id: string;
  rule_type: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
