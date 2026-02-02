-- ============================================================
-- Child accounts: compulsory profile photo (avatar_url)
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Parents must upload a photo of the child when creating the account.
-- Stored in Storage (e.g. chat-media/child-photos/{user_id}.ext).
-- ============================================================

alter table public.users
  add column if not exists avatar_url text;

comment on column public.users.avatar_url is 'Profile photo URL for child accounts (required when parent creates child). Stored in Storage.';
