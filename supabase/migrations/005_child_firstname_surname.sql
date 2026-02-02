-- ============================================================
-- Child accounts: first name and surname
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Parents enter first name + surname; username remains unique login key (e.g. firstname_surname).
-- ============================================================

-- Add first_name and surname for child accounts (nullable for existing rows)
alter table public.users
  add column if not exists first_name text,
  add column if not exists surname text;

comment on column public.users.first_name is 'Child first name (set by parent). Null for parent accounts.';
comment on column public.users.surname is 'Child surname (set by parent). Null for parent accounts.';
