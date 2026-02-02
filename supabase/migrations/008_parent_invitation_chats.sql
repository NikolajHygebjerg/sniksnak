-- ============================================================
-- Parent invitation chats: when a child invites another child,
-- the invited child's parent gets a chat from the inviting child's parent.
-- ============================================================

-- Links a parent–parent chat to the invitation (inviting child → invited child).
create table if not exists public.parent_invitation_chats (
  id serial primary key,
  chat_id uuid not null references public.chats(id) on delete cascade,
  inviting_child_id uuid not null references public.users(id) on delete cascade,
  invited_child_id uuid not null references public.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'rejected')) default 'pending',
  created_at timestamptz default now(),
  unique (inviting_child_id, invited_child_id),
  constraint inviting_invited_different check (inviting_child_id != invited_child_id)
);

create index if not exists parent_invitation_chats_chat_id on public.parent_invitation_chats(chat_id);
create index if not exists parent_invitation_chats_invited on public.parent_invitation_chats(invited_child_id);

alter table public.parent_invitation_chats enable row level security;

-- Either parent (of inviting or invited child) can read the invitation row for their chat
create policy "Parents can view invitation for their parent chat"
  on public.parent_invitation_chats for select
  to authenticated
  using (
    exists (
      select 1 from public.parent_child_links pcl
      where pcl.parent_id = auth.uid()
        and (pcl.child_id = parent_invitation_chats.inviting_child_id or pcl.child_id = parent_invitation_chats.invited_child_id)
    )
  );

-- Either parent (of inviting or invited child) can update status (accept/reject)
drop policy if exists "Parent of invited child can update invitation" on public.parent_invitation_chats;
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

-- Insert is done server-side (API with service role) when creating the parent chat
-- No policy for insert for authenticated; API uses service role.

comment on table public.parent_invitation_chats is 'Parent–parent chat created when a child invites another; invited parent can accept/reject and chat first.';
