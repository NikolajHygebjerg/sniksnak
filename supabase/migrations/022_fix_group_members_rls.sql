-- Migration 022: Fix RLS policy for group_members to avoid self-referencing issues
-- This migration fixes the RLS policy that may cause issues when querying group_members

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Children can view members of their groups" ON public.group_members;

-- Create improved policy that allows users to see:
-- 1. Their own membership records
-- 2. Other members' records if they are also a member of the same group
CREATE POLICY "Children can view members of their groups"
  ON public.group_members FOR SELECT
  TO authenticated
  USING (
    -- Can always see their own membership
    user_id = auth.uid()
    OR
    -- Can see other members if they are also a member of the same group
    -- Use a subquery that doesn't reference the same table alias
    EXISTS (
      SELECT 1
      FROM public.group_members other_members
      WHERE other_members.group_id = group_members.group_id
        AND other_members.user_id = auth.uid()
    )
  );
