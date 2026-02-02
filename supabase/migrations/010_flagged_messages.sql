-- ============================================================
-- Flagged messages: child safety keyword monitoring
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- When a child sends a message containing flagged keywords,
-- the system logs it here for parent review.
-- ============================================================

create table if not exists public.flagged_messages (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  matched_keyword text not null,
  category text not null,
  created_at timestamptz default now()
);

create index if not exists flagged_messages_child_id on public.flagged_messages(child_id);
create index if not exists flagged_messages_message_id on public.flagged_messages(message_id);
create index if not exists flagged_messages_created_at on public.flagged_messages(created_at);

alter table public.flagged_messages enable row level security;

-- Parents can view flagged messages for their linked children
create policy "Parents can view flagged messages for linked children"
  on public.flagged_messages for select
  to authenticated
  using (
    exists (
      select 1
      from public.parent_child_links
      where parent_child_links.child_id = flagged_messages.child_id
        and parent_child_links.parent_id = auth.uid()
    )
  );

-- Only backend/service role can insert (via API)
-- No policy needed - service role bypasses RLS
