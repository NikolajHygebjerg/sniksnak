-- Migration 025: Fix infinite recursion in group_members RLS policy
-- The current policy causes infinite recursion because it checks group_members
-- while evaluating the policy for group_members itself.
-- Solution: Use a security definer function to check membership without RLS

-- First, ensure we're running as postgres to create the function
-- SECURITY DEFINER functions run with the privileges of the function creator
-- which bypasses RLS checks when the creator is a superuser

-- Create a security definer function to check group membership
-- This function bypasses RLS to check if a user is a member of a group
CREATE OR REPLACE FUNCTION public.is_group_member(group_id_param uuid, user_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
COST 1
AS $$
  -- SECURITY DEFINER functions bypass RLS when created by a superuser (postgres)
  -- This query will not trigger RLS policies because it runs with superuser privileges
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members
    WHERE group_members.group_id = group_id_param
      AND group_members.user_id = user_id_param
  );
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) TO authenticated;

-- Drop all existing policies that might cause recursion
DROP POLICY IF EXISTS "Children can view members of their groups" ON public.group_members;
DROP POLICY IF EXISTS "Group admins can add members" ON public.group_members;
DROP POLICY IF EXISTS "Group admins can remove members" ON public.group_members;

-- Create new SELECT policy using the security definer function
-- This avoids recursion because the function bypasses RLS
CREATE POLICY "Children can view members of their groups"
  ON public.group_members FOR SELECT
  TO authenticated
  USING (
    -- Can always see their own membership (no recursion here)
    user_id = auth.uid()
    OR
    -- Can see other members if they are also a member of the same group
    -- Use the security definer function to avoid recursion
    -- The function bypasses RLS, so it won't trigger this policy again
    public.is_group_member(group_id, auth.uid())
  );

-- Also create a helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_group_admin(group_id_param uuid, user_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
COST 1
AS $$
  -- SECURITY DEFINER functions bypass RLS when created by a superuser (postgres)
  -- This query will not trigger RLS policies because it runs with superuser privileges
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members
    WHERE group_members.group_id = group_id_param
      AND group_members.user_id = user_id_param
      AND group_members.role = 'admin'
  );
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.is_group_admin(uuid, uuid) TO authenticated;

-- Drop and recreate INSERT policy to avoid recursion
DROP POLICY IF EXISTS "Group admins can add members" ON public.group_members;

CREATE POLICY "Group admins can add members"
  ON public.group_members FOR INSERT
  TO authenticated
  WITH CHECK (
    -- If user is already an admin of the group (using function to avoid recursion)
    public.is_group_admin(group_id, auth.uid())
    OR
    -- Or if the group creator is adding themselves as admin (for initial creation)
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

-- Also fix DELETE policy to avoid recursion
DROP POLICY IF EXISTS "Group admins can remove members" ON public.group_members;

CREATE POLICY "Group admins can remove members"
  ON public.group_members FOR DELETE
  TO authenticated
  USING (
    -- Use function to check admin status without recursion
    public.is_group_admin(group_id, auth.uid())
    AND user_id != auth.uid() -- Cannot remove yourself
  );

-- Also fix group_invitations INSERT policy to use the function
-- This avoids potential recursion issues when checking admin status
DROP POLICY IF EXISTS "Group admins can create invitations" ON public.group_invitations;

CREATE POLICY "Group admins can create invitations"
  ON public.group_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Use function to check admin status without recursion
    public.is_group_admin(group_id, auth.uid())
    AND invited_by = auth.uid()
  );

-- Fix groups SELECT policy to use function to avoid recursion
-- Also allow creators to see their groups even if they're not members yet
DROP POLICY IF EXISTS "Children can view groups they are members of" ON public.groups;

CREATE POLICY "Children can view groups they are members of"
  ON public.groups FOR SELECT
  TO authenticated
  USING (
    -- Use function to check membership without recursion
    public.is_group_member(id, auth.uid())
    OR
    -- Or if user is the creator of the group
    created_by = auth.uid()
  );
