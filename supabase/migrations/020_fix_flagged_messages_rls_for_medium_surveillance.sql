-- Migration 020: Fix RLS for flagged_messages to allow parents to see flagged messages
-- in chats where their child is a participant (either sender or receiver)
-- This is needed for Medium surveillance level to work correctly

-- Drop existing policy
DROP POLICY IF EXISTS "Parents can view flagged messages for linked children" ON public.flagged_messages;

-- Create new policy that allows parents to see flagged messages in chats where their child participates
-- This covers both cases:
-- 1. Their child sent a flagged message (child_id = their child)
-- 2. Their child received a flagged message (message is in a chat with their child)
CREATE POLICY "Parents can view flagged messages for linked children"
  ON public.flagged_messages FOR SELECT
  TO authenticated
  USING (
    -- Case 1: Parent's child sent the flagged message
    EXISTS (
      SELECT 1
      FROM public.parent_child_links
      WHERE parent_child_links.child_id = flagged_messages.child_id
        AND parent_child_links.parent_id = auth.uid()
    )
    OR
    -- Case 2: Parent's child is in a chat that contains this flagged message
    EXISTS (
      SELECT 1
      FROM public.messages
      JOIN public.chats ON chats.id = messages.chat_id
      JOIN public.parent_child_links ON (
        parent_child_links.child_id = chats.user1_id 
        OR parent_child_links.child_id = chats.user2_id
      )
      WHERE messages.id = flagged_messages.message_id
        AND parent_child_links.parent_id = auth.uid()
    )
  );
