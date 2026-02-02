-- ============================================================
-- Child accounts: username on users (no email for child display)
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Parents create children with username + PIN; child logs in with username + PIN.
-- Child auth users use a synthetic email (e.g. child-{uuid}@family.local).
-- ============================================================

-- Add username for child accounts (unique, nullable for existing parent accounts)
alter table public.users
  add column if not exists username text unique;

-- Index for child login lookup by username
create index if not exists users_username on public.users(username)
  where username is not null;

comment on column public.users.username is 'Display name for child accounts; used with PIN to log in. Null for parent (email) accounts.';
