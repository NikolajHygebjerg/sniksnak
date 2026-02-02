-- ============================================================
-- Fix RLS for parent_invitation_chats: allow both parents to update
-- Run this if you already ran 008_parent_invitation_chats.sql
-- ============================================================

-- Drop old policy and create new one that allows both parents to update
drop policy if exists "Parent of invited child can update invitation" on public.parent_invitation_chats;
drop policy if exists "Parents can update invitation for their parent chat" on public.parent_invitation_chats;

create policy "Parents can update invitation for their parent chat"
  on public.parent_invitation_chats for update
  to authenticated
  using (
    exists (
      select 1 from public.parent_child_links pcl
      where pcl.parent_id = auth.uid()
        and (pcl.child_id = parent_invitation_chats.inviting_child_id or pcl.child_id = parent_invitation_chats.invited_child_id)
    )
  )
  with check (
    exists (
      select 1 from public.parent_child_links pcl
      where pcl.parent_id = auth.uid()
        and (pcl.child_id = parent_invitation_chats.inviting_child_id or pcl.child_id = parent_invitation_chats.invited_child_id)
    )
  );
