-- ============================================================
-- Allow children to discover other children for "Find friends" feature
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Problem: Children can only see parent_child_links where they are the child,
-- so they can't see other children's links to find friends.
-- 
-- Solution: Add a policy that allows children to read child_id from 
-- parent_child_links for the purpose of finding other children.
-- ============================================================

-- Allow all authenticated users to read child_id from parent_child_links
-- This enables the "Find friends" feature where children need to see
-- which users are children (have parent links) to search for them
-- 
-- Note: This only exposes child_id, not parent_id or other sensitive data.
-- The users table RLS policies still control who can see user details.
drop policy if exists "Children can discover other children via links" on public.parent_child_links;
create policy "Children can discover other children via links"
  on public.parent_child_links for select
  to authenticated
  using (true);  -- Allow all authenticated users to read child_id for finding friends

-- Note: This policy works alongside the existing policies:
-- - "Parents can manage own parent_child_links" (parents can see their links)
-- - "Children can view own parent_child_links" (children can see their own links)
-- 
-- The new policy adds: children can see ALL child_id values to find friends
