-- Migration 027: Fix constraint to allow group chats
-- The chats table has a constraint that user1_id != user2_id
-- This prevents creating group chats where we use the same user for both fields
-- Solution: Modify the constraint to allow same user_id when group_id is set

-- Drop the existing constraint
ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_different_users;

-- Create new constraint that allows same user_id for group chats
ALTER TABLE public.chats ADD CONSTRAINT chats_different_users 
  CHECK (
    -- For direct chats (no group_id), users must be different
    (group_id IS NULL AND user1_id != user2_id)
    OR
    -- For group chats (has group_id), same user_id is allowed
    (group_id IS NOT NULL)
  );

-- Also need to update the unique index to handle group chats
-- Drop the existing unique index
DROP INDEX IF EXISTS public.chats_unique_pair;

-- Create a partial unique index for direct chats (one chat per pair)
CREATE UNIQUE INDEX IF NOT EXISTS chats_unique_pair_direct
  ON public.chats (least(user1_id, user2_id), greatest(user1_id, user2_id))
  WHERE group_id IS NULL;

-- Create a unique index for group chats (one chat per group)
CREATE UNIQUE INDEX IF NOT EXISTS chats_unique_group
  ON public.chats (group_id)
  WHERE group_id IS NOT NULL;
