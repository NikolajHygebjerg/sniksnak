-- ============================================================
-- Fix RLS for pending_contact_requests to allow upsert
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Problem: upsert() fails with 403 because:
-- 1. There's no UPDATE policy (needed for upsert when row exists)
-- 2. INSERT policy might be too restrictive or incorrectly configured
-- Solution: Add UPDATE policy and ensure INSERT policy works correctly
-- ============================================================

-- Drop existing policies if they exist and recreate them to ensure they work
DROP POLICY IF EXISTS "Contacts can create pending request (they started chat with child)" 
ON public.pending_contact_requests;

DROP POLICY IF EXISTS "Contacts can update pending request (they started chat with child)" 
ON public.pending_contact_requests;

-- Recreate INSERT policy - allow authenticated users to insert when:
-- 1. They are the contact_user_id (the one starting the chat) - MOST COMMON CASE
-- 2. OR they are a parent of the child_id (parent creating request on behalf of child)
-- This allows any authenticated user (child or parent) to create a pending request
CREATE POLICY "Contacts can create pending request (they started chat with child)"
  ON public.pending_contact_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if current user is the contact (starting the chat)
    contact_user_id = auth.uid()
    OR
    -- Allow if current user is a parent of the child (parent creating request)
    EXISTS (
      SELECT 1 FROM public.parent_child_links pcl
      WHERE pcl.parent_id = auth.uid() 
      AND pcl.child_id = pending_contact_requests.child_id
    )
  );

-- Allow contacts to update their own pending requests (for upsert to work)
-- This is needed when upsert tries to UPDATE an existing row instead of INSERT
-- The policy allows updating when:
-- 1. contact_user_id = auth.uid() (the current user owns the request)
-- 2. OR the user is a parent of the child_id
CREATE POLICY "Contacts can update pending request (they started chat with child)"
  ON public.pending_contact_requests FOR UPDATE
  TO authenticated
  USING (
    contact_user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.parent_child_links pcl
      WHERE pcl.parent_id = auth.uid() 
      AND pcl.child_id = pending_contact_requests.child_id
    )
  )
  WITH CHECK (
    contact_user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.parent_child_links pcl
      WHERE pcl.parent_id = auth.uid() 
      AND pcl.child_id = pending_contact_requests.child_id
    )
  );
