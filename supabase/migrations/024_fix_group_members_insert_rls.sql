-- Migration 024: Fix RLS policy for group_members INSERT to allow group creators to add themselves
-- This ensures that when a group is created, the creator can be added as an admin member

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Group admins can add members" ON public.group_members;

-- Create improved policy that allows:
-- 1. Group admins to add members
-- 2. Group creators to add themselves as admin (for initial group creation)
CREATE POLICY "Group admins can add members"
  ON public.group_members FOR INSERT
  TO authenticated
  WITH CHECK (
    -- If user is already an admin of the group
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = group_members.group_id
        AND gm.user_id = auth.uid()
        AND gm.role = 'admin'
    )
    OR
    -- Or if the group creator is adding themselves as admin (for initial creation)
    -- This allows the creator to add themselves immediately after creating the group
    (
      EXISTS (
        SELECT 1
        FROM public.groups g
        WHERE g.id = group_members.group_id
          AND g.created_by = auth.uid()
      )
      AND group_members.user_id = auth.uid()
      AND group_members.role = 'admin'
    )
  );
