-- ============================================================
-- Phase 1: Chat App – Supabase schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLES
-- ------------------------------------------------------------

-- Public users (synced from Auth). One row per signed-up user.
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz default now()
);

-- One-to-one chats. One row per pair of users.
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null references public.users(id) on delete cascade,
  user2_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  constraint chats_different_users check (user1_id != user2_id)
);

-- One chat per pair (order of user1/user2 does not matter)
create unique index if not exists chats_unique_pair on public.chats (least(user1_id, user2_id), greatest(user1_id, user2_id));

-- Text messages in a chat.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

-- Indexes for common queries
create index if not exists chats_user1_id on public.chats(user1_id);
create index if not exists chats_user2_id on public.chats(user2_id);
create index if not exists messages_chat_id on public.messages(chat_id);
create index if not exists messages_created_at on public.messages(chat_id, created_at);

-- ------------------------------------------------------------
-- 2. ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------

alter table public.users enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;

-- Users: everyone can read (to show "who can I chat with"), only own row can be updated (e.g. profile)
drop policy if exists "Users are viewable by authenticated users" on public.users;
create policy "Users are viewable by authenticated users"
  on public.users for select
  to authenticated
  using (true);

drop policy if exists "Users can update own row" on public.users;
create policy "Users can update own row"
  on public.users for update
  to authenticated
  using (auth.uid() = id);

-- Chats: only the two participants can read
drop policy if exists "Chat participants can view chat" on public.chats;
create policy "Chat participants can view chat"
  on public.chats for select
  to authenticated
  using (
    auth.uid() = user1_id or auth.uid() = user2_id
  );

drop policy if exists "Authenticated users can create chats" on public.chats;
create policy "Authenticated users can create chats"
  on public.chats for insert
  to authenticated
  with check (
    auth.uid() = user1_id or auth.uid() = user2_id
  );

-- Messages: only participants of the chat can read/insert
drop policy if exists "Chat participants can view messages" on public.messages;
create policy "Chat participants can view messages"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
    )
  );

drop policy if exists "Chat participants can send messages" on public.messages;
create policy "Chat participants can send messages"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
    )
  );

-- ------------------------------------------------------------
-- 3. SYNC AUTH USERS → public.users
-- ------------------------------------------------------------
-- When someone signs up with Supabase Auth, add a row to public.users.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Optional: backfill existing Auth users into public.users (run once if you already have users)
-- insert into public.users (id, email)
-- select id, email from auth.users
-- on conflict (id) do update set email = excluded.email;

-- ------------------------------------------------------------
-- 4. REALTIME (enable for messages)
-- ------------------------------------------------------------
-- Run this so new messages are pushed to the app instantly.
-- If it errors (e.g. "already in publication"), enable in the UI instead:
-- Database → Replication → find "messages" → toggle ON.

alter publication supabase_realtime add table public.messages;
