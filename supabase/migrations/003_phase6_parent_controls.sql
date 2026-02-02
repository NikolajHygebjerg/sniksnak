-- ============================================================
-- Phase 6: Parent controls and moderation
-- Run in: Supabase Dashboard → SQL Editor (or run migrations)
-- ============================================================
-- Adds: parent_child_links, flags, and RLS so parents can view
-- linked children's chats/messages; children only see their own;
-- authenticated users can insert flags.
-- ============================================================

-- ------------------------------------------------------------
-- 1. parent_child_links – links a parent user to a child user
-- ------------------------------------------------------------
create table if not exists public.parent_child_links (
  id serial primary key,
  parent_id uuid not null references public.users(id) on delete cascade,
  child_id uuid not null references public.users(id) on delete cascade,
  unique (parent_id, child_id),
  constraint parent_child_different check (parent_id != child_id)
);

create index if not exists parent_child_links_parent_id on public.parent_child_links(parent_id);
create index if not exists parent_child_links_child_id on public.parent_child_links(child_id);

alter table public.parent_child_links enable row level security;

-- Parents can manage their own links (where they are the parent)
create policy "Parents can manage own parent_child_links"
  on public.parent_child_links for all
  to authenticated
  using (auth.uid() = parent_id)
  with check (auth.uid() = parent_id);

-- Children can read links where they are the child (view who their parents are)
create policy "Children can view own parent_child_links"
  on public.parent_child_links for select
  to authenticated
  using (auth.uid() = child_id);

-- ------------------------------------------------------------
-- 2. flags – moderation flags on messages (e.g. inappropriate)
-- ------------------------------------------------------------
create table if not exists public.flags (
  id serial primary key,
  message_id uuid not null references public.messages(id) on delete cascade,
  flagged_by uuid not null references public.users(id) on delete cascade,
  reason text,
  created_at timestamptz default now()
);

create index if not exists flags_message_id on public.flags(message_id);
create index if not exists flags_flagged_by on public.flags(flagged_by);

alter table public.flags enable row level security;

-- Only authenticated users can insert into flags (any participant or parent can flag)
create policy "Authenticated users can insert flags"
  on public.flags for insert
  to authenticated
  with check (auth.uid() = flagged_by);

-- Users can read flags for messages they can see: either they're in the chat, or they're a parent of a linked child in that chat
create policy "Participants and parents can read flags"
  on public.flags for select
  to authenticated
  using (
    -- Participant in the chat that contains this message
    exists (
      select 1 from public.messages m
      join public.chats c on c.id = m.chat_id
      where m.id = flags.message_id
        and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
    )
    or
    -- Parent of a linked child who is in that chat
    exists (
      select 1 from public.messages m
      join public.chats c on c.id = m.chat_id
      join public.parent_child_links pcl on (pcl.child_id = c.user1_id or pcl.child_id = c.user2_id)
      where m.id = flags.message_id
        and pcl.parent_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 3. RLS: Parents can read chats where a linked child is a participant
-- ------------------------------------------------------------
create policy "Parents can view chats of linked children"
  on public.chats for select
  to authenticated
  using (
    exists (
      select 1 from public.parent_child_links pcl
      where pcl.parent_id = auth.uid()
        and (pcl.child_id = user1_id or pcl.child_id = user2_id)
    )
  );

-- ------------------------------------------------------------
-- 4. RLS: Parents can read messages in chats involving a linked child
--    (Children already only see their own messages via "Chat participants can view messages")
-- ------------------------------------------------------------
create policy "Parents can view messages of linked children"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.chats c
      join public.parent_child_links pcl on (pcl.child_id = c.user1_id or pcl.child_id = c.user2_id)
      where c.id = messages.chat_id
        and pcl.parent_id = auth.uid()
    )
  );
