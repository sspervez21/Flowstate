-- Migration 003: Add relevance scoring and user rules

-- Per-user relevance scores for each message
CREATE TABLE relevance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score real NOT NULL DEFAULT 0,           -- 0.0 (irrelevant) to 1.0 (critical)
  signals jsonb NOT NULL DEFAULT '{}',     -- { "mention": 0.4, "channel_freq": 0.3, ... }
  scored_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX idx_scores_user_score ON relevance_scores(user_id, score DESC);
CREATE INDEX idx_scores_message ON relevance_scores(message_id);

-- User-defined rules that influence scoring
CREATE TABLE user_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_type text NOT NULL,                 -- 'keyword', 'channel_boost', 'person_boost', 'topic'
  config jsonb NOT NULL DEFAULT '{}',      -- varies by rule_type
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rules_user ON user_rules(user_id);

-- Track per-user channel activity (for "channels I visit/write to most")
CREATE TABLE user_channel_stats (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  messages_sent int NOT NULL DEFAULT 0,
  mentions_received int NOT NULL DEFAULT 0,
  last_active_at timestamptz,
  PRIMARY KEY (user_id, channel_id)
);
