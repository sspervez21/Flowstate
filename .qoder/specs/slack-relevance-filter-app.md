# Slack Relevance Filter App — Implementation Plan

## Context

Slack is noisy. Users in active workspaces are overwhelmed by hundreds of messages across dozens of channels daily. This app solves that by ingesting Slack data and ranking messages/channels by personal relevance — like a search engine for your Slack. Users see the most important content first and progressively load more, instead of manually scanning every channel.

**Stack**: React (Vite) frontend + InsForge (cloud) backend (Postgres + pgvector, Edge Functions, Model Gateway, Auth)

---

## Project Structure

```
Flowstate/
├── package.json                      # Root (npm workspaces)
├── web/                              # React frontend (Vite + TypeScript + Tailwind)
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                    # Router + AuthProvider
│       ├── insforge.ts               # InsForge client singleton
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── FeedPage.tsx
│       │   └── SettingsPage.tsx
│       ├── components/
│       │   ├── MessageCard.tsx
│       │   ├── FeedList.tsx
│       │   ├── ChannelSidebar.tsx
│       │   ├── RelevanceBar.tsx
│       │   ├── LoadMoreButton.tsx
│       │   └── TopBar.tsx
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useFeed.ts
│       │   ├── useChannels.ts
│       │   └── useSyncStatus.ts
│       └── lib/
│           └── types.ts
│
├── functions/                        # InsForge Edge Functions
│   ├── slack-oauth-callback/
│   │   └── index.ts
│   ├── slack-sync/
│   │   └── index.ts
│   ├── compute-relevance/
│   │   └── index.ts
│   └── _shared/
│       ├── insforge-admin.ts         # Service-role client
│       ├── slack-api.ts              # Slack Web API wrapper
│       └── embeddings.ts            # Model Gateway embedding calls
│
├── migrations/
│   ├── 001_enable_pgvector.sql
│   ├── 002_create_tables.sql
│   └── 003_create_db_functions.sql
│
└── .gitignore
```

---

## Database Schema

All tables in InsForge Postgres. Row Level Security enabled.

### `workspaces`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `slack_team_id` | `text` UNIQUE | |
| `team_name` | `text` | |
| `bot_token` | `text` | Encrypted Slack bot token |
| `last_synced_at` | `timestamptz` | Watermark for incremental sync |
| `created_at` | `timestamptz` | |

### `users`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | Matches InsForge auth user ID |
| `workspace_id` | `uuid` FK | |
| `slack_user_id` | `text` | |
| `display_name` | `text` | |
| `avatar_url` | `text` | |
| `slack_token` | `text` | User OAuth token |
| `created_at` | `timestamptz` | |

### `channels`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` FK | |
| `slack_channel_id` | `text` | |
| `name` | `text` | |
| `topic` | `text` | |
| `member_count` | `int` | |
| `last_message_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |

Unique: `(workspace_id, slack_channel_id)`

### `messages`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` FK | |
| `channel_id` | `uuid` FK | |
| `slack_ts` | `text` | Slack message timestamp ID |
| `author_slack_id` | `text` | |
| `author_name` | `text` | Denormalized |
| `content` | `text` | |
| `thread_ts` | `text` NULL | Thread parent |
| `reply_count` | `int` DEFAULT 0 | |
| `reaction_count` | `int` DEFAULT 0 | |
| `embedding` | `vector(1536)` | pgvector — message embedding |
| `posted_at` | `timestamptz` | |
| `synced_at` | `timestamptz` | |

Unique: `(workspace_id, channel_id, slack_ts)` | Index: IVFFlat on `embedding`, B-tree on `(workspace_id, channel_id, posted_at)`

### `user_preferences`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK | |
| `priority_topics` | `text[]` | e.g. `["deployments", "API changes"]` |
| `priority_channels` | `uuid[]` | High-priority channel IDs |
| `muted_channels` | `uuid[]` | Suppressed channels |
| `preference_embedding` | `vector(1536)` | Embedding of combined priority topics |
| `updated_at` | `timestamptz` | |

### `relevance_scores`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK | |
| `message_id` | `uuid` FK | |
| `score` | `float` | 0.0 - 1.0 composite |
| `signals` | `jsonb` | `{ "semantic": 0.7, "recency": 0.2, ... }` |
| `computed_at` | `timestamptz` | |

Unique: `(user_id, message_id)` | Index: `(user_id, score DESC)` — primary feed query path

### DB Functions

**`match_messages_for_user(p_user_id, p_channel_id, p_limit, p_offset)`** — Joins `relevance_scores` + `messages` + `channels`, returns messages ordered by `score DESC`. Called via `insforge.rpc()` from frontend.

---

## Edge Functions

### `slack-oauth-callback`
1. Receives `code` from Slack OAuth redirect
2. Exchanges code for tokens via `oauth.v2.access`
3. Upserts `workspaces` and `users` records
4. Creates InsForge auth session
5. Redirects browser to `/feed` with session tokens

### `slack-sync`
1. For each workspace: fetch channels via `conversations.list`, upsert into `channels`
2. For each channel: fetch new messages via `conversations.history` (incremental using `last_synced_at` watermark)
3. Batch-insert messages, update watermark
4. Trigger `compute-relevance` after ingestion
5. Rate-limited: sequential channel processing, max 20 channels per run, bounded to ~30s execution

### `compute-relevance`
1. Find messages with `embedding IS NULL`
2. Batch-embed via InsForge Model Gateway (`text-embedding-3-small`, 1536 dims)
3. For short messages (< 10 words), prepend channel name for context
4. For each user, compute composite relevance score per message:

```
semantic    = 1.0 - cosine_distance(message.embedding, user.preference_embedding)
recency     = exp(-0.03 * hours_since_posted)   // ~23hr half-life
engagement  = min(1.0, (reply_count + reaction_count) / 10.0)
channel_boost = 0.2 if channel in priority_channels, else 0.0

if channel in muted_channels: score = 0.0
else: score = 0.50*semantic + 0.25*recency + 0.15*engagement + 0.10*channel_boost
```

5. Upsert into `relevance_scores`

**Cold start**: No user preferences -> semantic defaults to 0.5, feed ranks by recency + engagement.

---

## React App

**Tech**: Vite + React 18 + TypeScript, Tailwind CSS, React Router v6, TanStack Query

### Pages
- **LoginPage** — "Sign in with Slack" button, redirects to Slack OAuth
- **FeedPage** — Main view: `TopBar` + `ChannelSidebar` + `FeedList` (MessageCards with RelevanceBar) + `LoadMoreButton`
- **SettingsPage** — Priority topics editor (tag input), channel priority toggles, mute toggles, manual sync button

### Key Hooks
- **`useAuth()`** — Session management via `insforge.auth`, exposes `user`, `login()`, `logout()`
- **`useFeed({ channelId?, page })`** — Calls `match_messages_for_user` RPC, uses `useInfiniteQuery` for progressive loading
- **`useChannels()`** — Fetches channel list from InsForge DB
- **`useSyncStatus()`** — Polls `workspaces.last_synced_at` every 30s

### Auth Flow
```
"Sign in with Slack" -> Slack OAuth -> slack-oauth-callback Edge Function
  -> exchange code -> create session -> redirect to /feed#tokens
  -> React picks up tokens -> insforge.auth.setSession() -> feed loads
```

### Feed Flow
```
/feed loads -> useFeed(page=0) -> RPC match_messages_for_user
  -> 20 messages by score DESC -> render MessageCards
  -> "Load more" -> page=1 -> next 20 (lower relevance) -> append
```

---

## Build Phases (Incremental)

### Phase 1: "Plumbing" — Auth + Sync + Basic Feed
Get data flowing end-to-end. No AI yet.

1. Scaffold Vite + React + Tailwind project in `web/`
2. Set up root `package.json` with npm workspaces
3. Apply migrations: `workspaces`, `users`, `channels`, `messages` (skip `embedding` column, `relevance_scores`, `user_preferences` for now)
4. Build `slack-oauth-callback` Edge Function — working Slack sign-in
5. Build `slack-sync` Edge Function — fetches channels + messages from Slack API
6. Build `LoginPage` with Slack OAuth button
7. Build minimal `FeedPage` — queries `messages` table directly, sorted by `posted_at DESC`, paginated
8. Build `MessageCard` component — shows content, author, channel, timestamp
9. Add manual "Sync Now" button to trigger `slack-sync`

**Outcome**: Sign in with Slack, see your messages in reverse-chronological order.

### Phase 2: "Relevance" — AI Scoring + Ranked Feed
The core value prop.

1. Add `embedding vector(1536)` to `messages`, enable pgvector, create `relevance_scores` and `user_preferences` tables
2. Build `compute-relevance` Edge Function — embed messages, compute composite scores
3. Create `match_messages_for_user` DB function
4. Update `FeedPage` to use RPC-based ranked feed instead of raw query
5. Add `RelevanceBar` to `MessageCard`
6. Build `SettingsPage` — priority topics editor
7. Wire: `slack-sync` -> triggers `compute-relevance` after ingestion
8. Handle cold start (no preferences -> recency+engagement fallback)

**Outcome**: Messages ranked by personal relevance. Settings let users tune their feed.

### Phase 3: "Polish" — Channel Controls + UX
1. Build `ChannelSidebar` — filter feed by channel
2. Add channel mute/priority toggles in Settings
3. Build `TopBar` with sync status indicator
4. Set up cron-based automatic sync (every 5 min)
5. Loading states, empty states, error boundaries
6. Style refinement

**Outcome**: Full, polished MVP experience.

### Phase 4 (Future): "Intelligence"
- Implicit engagement tracking (clicks/expands feed back as signal)
- "Mark as important" / "Not relevant" buttons
- "Show more like this" via pgvector similarity search
- Search bar (embed query, nearest neighbor lookup)
- Daily digest Edge Function

---

## Environment Variables

**Frontend (`.env`)**:
- `VITE_INSFORGE_URL` — InsForge project URL
- `VITE_INSFORGE_ANON_KEY` — Public anon key
- `VITE_SLACK_CLIENT_ID` — Slack app client ID

**Edge Functions (InsForge secrets)**:
- `INSFORGE_SERVICE_ROLE_KEY`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `MODEL_GATEWAY_URL`
- `MODEL_GATEWAY_KEY`

---

## Slack App Configuration

Create a Slack app at https://api.slack.com/apps with:
- **OAuth scopes (Bot)**: `channels:read`, `channels:history`, `users:read`, `reactions:read`, `team:read`
- **OAuth scopes (User)**: `channels:read`, `channels:history`
- **Redirect URL**: `{INSFORGE_URL}/functions/v1/slack-oauth-callback`

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Pre-computed scores in `relevance_scores` | Feed query is fast `ORDER BY score DESC` with index. Embedding calls happen once per message, not per page load. |
| Polling not Events API | Simpler for MVP. No public webhook needed. 5-min delay acceptable for a digest-style app. |
| Embeddings not LLM scoring | 10-100x cheaper, deterministic, batch-able. Composite formula is tunable and explainable. |
| pgvector for similarity | Native Postgres, no extra service. Supports both pre-computed scoring and future search features. |
| RLS on all tables | Security by default. Users only see their own workspace data and scores. |

---

## Verification

1. **Phase 1**: Click "Sign in with Slack" -> complete OAuth -> see messages from your Slack channels listed in the feed, sorted by time. Click "Sync Now" -> new messages appear.
2. **Phase 2**: Add priority topics in Settings -> refresh feed -> messages matching topics appear higher. Check `relevance_scores` table has entries. Verify `RelevanceBar` shows score visually.
3. **Phase 3**: Click channels in sidebar -> feed filters. Mute a channel -> its messages disappear from feed. Sync status shows in TopBar.
4. **End-to-end**: Post a message in Slack about a topic in your priorities -> wait for sync -> message appears near top of feed.

---

## Critical Files

- `migrations/002_create_tables.sql` — entire data model, indexes, RLS policies
- `functions/slack-oauth-callback/index.ts` — auth lynchpin
- `functions/slack-sync/index.ts` — data pipeline
- `functions/compute-relevance/index.ts` — core relevance engine
- `web/src/hooks/useFeed.ts` — bridge between relevance engine and UI
- `web/src/pages/FeedPage.tsx` — main user-facing view
