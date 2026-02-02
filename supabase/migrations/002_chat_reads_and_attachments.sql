-- ============================================================
-- Chat App – chat_reads, message attachments, storage
-- Run in: Supabase Dashboard → SQL Editor (or run migrations)
-- ============================================================

-- 1. Chat read receipts (for unread count)
create table if not exists public.chat_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

alter table public.chat_reads enable row level security;

create policy "Users can manage own chat_reads"
  on public.chat_reads for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists chat_reads_chat_id on public.chat_reads(chat_id);

-- 2. Message attachments (optional columns)
alter table public.messages
  add column if not exists attachment_url text,
  add column if not exists attachment_type text;

-- Allow empty content when there's an attachment
alter table public.messages alter column content drop not null;
-- Backfill: ensure existing rows have content set
update public.messages set content = '' where content is null;
alter table public.messages alter column content set default '';

-- 3. Storage bucket: create in Supabase Dashboard → Storage → New bucket
--    Name: chat-media, Public: ON
--    Then add policies in Storage → chat-media → Policies:
--    - "Allow authenticated upload" (insert for authenticated, bucket_id = 'chat-media')
--    - "Allow authenticated read" (select for authenticated, bucket_id = 'chat-media')
