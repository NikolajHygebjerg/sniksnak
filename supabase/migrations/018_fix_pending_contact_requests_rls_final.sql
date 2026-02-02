-- ============================================================
-- Final fix for pending_contact_requests RLS
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Problem: INSERT still fails with 42501 (RLS violation)
-- Solution: Drop all policies and recreate with simple, correct logic
-- ============================================================

-- First, list all existing policies to see what we're working with
-- Run this to check: SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
-- FROM pg_policies WHERE tablename = 'pending_contact_requests';

-- Drop ALL existing policies on this table to start completely fresh
DROP POLICY IF EXISTS "Contacts can create pending request (they started chat with child)" 
ON public.pending_contact_requests;

DROP POLICY IF EXISTS "Contacts can update pending request (they started chat with child)" 
ON public.pending_contact_requests;

-- Also drop any other policies that might exist (in case they were created with different names)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pending_contact_requests') LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.pending_contact_requests';
    END LOOP;
END $$;

-- Now create the INSERT policy - SIMPLE: allow if contact_user_id = auth.uid()
-- This means the authenticated user must be the one starting the chat
CREATE POLICY "Contacts can create pending request (they started chat with child)"
  ON public.pending_contact_requests FOR INSERT
  TO authenticated
  WITH CHECK (contact_user_id = auth.uid());

-- Create UPDATE policy for upsert to work
-- Same logic: allow if contact_user_id = auth.uid()
CREATE POLICY "Contacts can update pending request (they started chat with child)"
  ON public.pending_contact_requests FOR UPDATE
  TO authenticated
  USING (contact_user_id = auth.uid())
  WITH CHECK (contact_user_id = auth.uid());

-- Verify policies were created correctly
-- Run this to verify: SELECT schemaname, tablename, policyname, cmd, with_check 
-- FROM pg_policies WHERE tablename = 'pending_contact_requests';
