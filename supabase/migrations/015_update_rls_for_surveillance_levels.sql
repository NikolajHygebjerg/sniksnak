-- ============================================================
-- Update RLS policies to respect surveillance levels
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Updates RLS policies so that:
-- - 'strict': Parents can view chats and messages (existing behavior)
-- - 'medium': Parents can view chats/messages only after keyword notification (via flagged_messages)
-- - 'mild': Parents cannot view chats/messages directly (only via child flags)
-- ============================================================

-- Drop existing parent chat/message policies
drop policy if exists "Parents can view chats of linked children" on public.chats;
drop policy if exists "Parents can view messages of linked children" on public.messages;
drop policy if exists "Strict and medium level parents can view chats of linked children" on public.chats;
drop policy if exists "Strict and medium level parents can view messages of linked children" on public.messages;
drop policy if exists "Strict level parents can view chats of linked children" on public.chats;
drop policy if exists "Strict level parents can view messages of linked children" on public.messages;

-- New policy: Only 'strict' level parents can view chats directly
-- Medium level parents must access via frontend check (which verifies flagged messages)
-- - 'strict': Full access to all chats
-- - 'medium': Can only access chats with flagged messages (enforced by frontend)
-- - 'mild': No direct access (only via child flags)
create policy "Strict level parents can view chats of linked children"
  on public.chats for select
  to authenticated
  using (
    exists (
      select 1 from public.parent_child_links pcl
      where pcl.parent_id = auth.uid()
        and pcl.surveillance_level = 'strict'
        and (pcl.child_id = user1_id or pcl.child_id = user2_id)
    )
  );

-- New policy: Only 'strict' level parents can view messages directly
-- Medium level parents can access messages via frontend check (which verifies flagged messages exist)
-- Note: Medium level parents need RLS access to read messages when flagged, so we allow
-- medium level but frontend enforces the restriction
create policy "Strict and medium level parents can view messages (frontend enforces medium restriction)"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.chats c
      join public.parent_child_links pcl on (pcl.child_id = c.user1_id or pcl.child_id = c.user2_id)
      where c.id = messages.chat_id
        and pcl.parent_id = auth.uid()
        and pcl.surveillance_level in ('strict', 'medium')
    )
  );

-- Note: Frontend filters chat list and enforces access checks:
-- - 'strict' level: See all chats, can access any chat
-- - 'medium' level: Only see chats with flagged messages, can only access chats with flagged messages
-- - 'mild' level: Cannot access chats/messages directly - only get notifications when child flags
