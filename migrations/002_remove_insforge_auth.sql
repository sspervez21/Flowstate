-- Migration 002: Remove InsForge auth dependency
-- All database access now goes through Edge Functions (admin client),
-- so RLS is redundant. Users table gets auto-generated UUIDs.

-- Add default to users.id so we don't need to supply an InsForge auth user ID
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Drop all RLS policies
DROP POLICY IF EXISTS "users_read_own" ON users;
DROP POLICY IF EXISTS "users_read_workspace" ON workspaces;
DROP POLICY IF EXISTS "channels_read_workspace" ON channels;
DROP POLICY IF EXISTS "messages_read_workspace" ON messages;

-- Disable RLS on all tables (Edge Functions use admin API_KEY)
ALTER TABLE workspaces DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE channels DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
