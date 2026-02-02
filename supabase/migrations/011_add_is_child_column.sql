-- ============================================================
-- Add is_child column to users table
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Adds a boolean column to distinguish child users from parents.
-- Updates existing children (identified by parent_child_links or username) to is_child = true.
-- ============================================================

-- Add is_child column with default false
alter table public.users 
  add column if not exists is_child boolean not null default false;

-- Create index for efficient filtering
create index if not exists users_is_child on public.users(is_child) where is_child = true;

-- Update existing children to is_child = true
-- Method 1: Users who are linked as children in parent_child_links
update public.users
set is_child = true
where id in (
  select distinct child_id 
  from public.parent_child_links
);

-- Method 2: Users with username set (children typically have usernames)
-- This catches any children that might not have parent links yet
update public.users
set is_child = true
where username is not null 
  and trim(username) != ''
  and is_child = false;

-- Enable RLS on users table (if not already enabled)
alter table public.users enable row level security;

-- Create policy: Children can discover other children
-- This allows authenticated users to see children (is_child = true) for the "Find children" feature
-- Note: This policy allows any authenticated user to see children rows.
-- The existing policy "Users are viewable by authenticated users" already allows seeing all users,
-- so this policy specifically enables filtering by is_child = true.
drop policy if exists "Children can discover other children" on public.users;
create policy "Children can discover other children"
  on public.users for select
  to authenticated
  using (is_child = true);
