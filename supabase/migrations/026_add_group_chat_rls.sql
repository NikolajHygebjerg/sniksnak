-- Migration 026: Add RLS policies for group chats
-- Allow group members to view and access group chats

-- Drop existing chat SELECT policy and recreate with group support
DROP POLICY IF EXISTS "Chat participants can view chat" ON public.chats;

-- Add policy for group chats SELECT
-- Group members can view group chats for groups they belong to
-- Use function to avoid recursion
CREATE POLICY "Chat participants can view chat"
  ON public.chats FOR SELECT
  TO authenticated
  USING (
    -- If it's a group chat (has group_id), check membership using function
    (group_id IS NOT NULL
     AND public.is_group_member(group_id, auth.uid()))
    OR
    -- Otherwise, use existing policy (direct chat between two users)
    (group_id IS NULL AND (auth.uid() = user1_id OR auth.uid() = user2_id))
  );

-- Drop existing chat INSERT policy and recreate with group support
DROP POLICY IF EXISTS "Authenticated users can create chats" ON public.chats;

-- Add policy for group chats INSERT
-- Group members can create group chats for groups they belong to
-- Use function to avoid recursion
CREATE POLICY "Authenticated users can create chats"
  ON public.chats FOR INSERT
  TO authenticated
  WITH CHECK (
    -- If it's a group chat (has group_id), check membership using function
    (group_id IS NOT NULL
     AND public.is_group_member(group_id, auth.uid()))
    OR
    -- Otherwise, use existing policy (direct chat between two users)
    (group_id IS NULL AND (auth.uid() = user1_id OR auth.uid() = user2_id))
  );

-- Update messages policy to allow group members to view messages in group chats
-- Drop existing policy if it exists and recreate with group support
-- Use function to avoid recursion
DROP POLICY IF EXISTS "Chat participants can view messages" ON public.messages;

CREATE POLICY "Chat participants can view messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chats c
      WHERE c.id = messages.chat_id
        AND (
          -- Direct chat: user is one of the participants
          (c.group_id IS NULL AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid()))
          OR
          -- Group chat: user is a member of the group (use function to avoid recursion)
          (c.group_id IS NOT NULL
           AND public.is_group_member(c.group_id, auth.uid()))
        )
    )
  );

-- Update messages INSERT policy to allow group members to send messages in group chats
-- Use function to avoid recursion
DROP POLICY IF EXISTS "Chat participants can send messages" ON public.messages;

CREATE POLICY "Chat participants can send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.chats c
      WHERE c.id = messages.chat_id
        AND (
          -- Direct chat: user is one of the participants
          (c.group_id IS NULL AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid()))
          OR
          -- Group chat: user is a member of the group (use function to avoid recursion)
          (c.group_id IS NOT NULL
           AND public.is_group_member(c.group_id, auth.uid()))
        )
    )
    AND sender_id = auth.uid()
  );
