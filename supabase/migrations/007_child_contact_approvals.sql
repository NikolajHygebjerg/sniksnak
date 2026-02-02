-- ============================================================
-- Child contact approvals: parent must accept before child sees chat
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- When someone unknown starts a chat with a child, the parent gets a
-- pending request and must accept before the child sees the chat/messages.
-- ============================================================

-- Parent has approved that contact_user_id can chat with child_id
create table if not exists public.parent_approved_contacts (
  id serial primary key,
  child_id uuid not null references public.users(id) on delete cascade,
  contact_user_id uuid not null references public.users(id) on delete cascade,
  parent_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (child_id, contact_user_id),
  constraint child_contact_different check (child_id != contact_user_id)
);

create index if not exists parent_approved_contacts_child_id on public.parent_approved_contacts(child_id);
create index if not exists parent_approved_contacts_parent_id on public.parent_approved_contacts(parent_id);

alter table public.parent_approved_contacts enable row level security;

-- Parents can manage approvals for their linked children
create policy "Parents can manage approved contacts for linked children"
  on public.parent_approved_contacts for all
  to authenticated
  using (
    exists (
      select 1 from public.parent_child_links pcl
      where pcl.parent_id = auth.uid() and pcl.child_id = parent_approved_contacts.child_id
    )
  )
  with check (
    parent_id = auth.uid()
    and exists (
      select 1 from public.parent_child_links pcl
      where pcl.parent_id = auth.uid() and pcl.child_id = parent_approved_contacts.child_id
    )
  );

-- Children can read their own approved contacts (to filter chat list)
create policy "Children can read own approved contacts"
  on public.parent_approved_contacts for select
  to authenticated
  using (child_id = auth.uid());


-- Pending request: someone started a chat with a child; parent must accept
create table if not exists public.pending_contact_requests (
  id serial primary key,
  child_id uuid not null references public.users(id) on delete cascade,
  contact_user_id uuid not null references public.users(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  created_at timestamptz default now(),
  unique (child_id, contact_user_id),
  constraint pending_child_contact_different check (child_id != contact_user_id)
);

create index if not exists pending_contact_requests_child_id on public.pending_contact_requests(child_id);
create index if not exists pending_contact_requests_parent_id on public.pending_contact_requests(chat_id);

-- Need to get parent from child: parent_child_links. So parents can see/update requests for their linked children.
-- Allow insert from service role or from authenticated when creating a chat (we'll use API).
alter table public.pending_contact_requests enable row level security;

-- Parents can view and delete (accept = delete + add to approved; reject = delete) their children's pending requests
create policy "Parents can view pending requests for linked children"
  on public.pending_contact_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.parent_child_links pcl
      where pcl.parent_id = auth.uid() and pcl.child_id = pending_contact_requests.child_id
    )
  );

create policy "Parents can delete pending requests for linked children"
  on public.pending_contact_requests for delete
  to authenticated
  using (
    exists (
      select 1 from public.parent_child_links pcl
      where pcl.parent_id = auth.uid() and pcl.child_id = pending_contact_requests.child_id
    )
  );

-- Insert: only via service role (API when creating chat) or allow authenticated to insert if they are the contact (someone started chat with child)
-- Actually the chat is created by the "contact" user; the API or client will insert into pending_contact_requests. So we need either service role in API or a policy that allows insert when contact_user_id = auth.uid() and child_id is a child. Simpler: allow insert for authenticated when contact_user_id = auth.uid() (so the person who started the chat creates the pending request). But then we need to know child_id and chat_id - the insert happens from our app when we create the chat. So the client could insert: contact_user_id = me, child_id = other user (the child), chat_id = the new chat. So policy: allow insert when contact_user_id = auth.uid(). That way when user A creates a chat with child B, we need to insert (child_id=B, contact_user_id=A, chat_id=...). So the insert is done by A (the contact). So policy: with check (contact_user_id = auth.uid()).
create policy "Contacts can create pending request (they started chat with child)"
  on public.pending_contact_requests for insert
  to authenticated
  with check (contact_user_id = auth.uid());

comment on table public.parent_approved_contacts is 'Parent has approved that contact_user_id can chat with child_id; child only sees chats with approved contacts.';
comment on table public.pending_contact_requests is 'Someone started a chat with a child; parent must accept before child sees it.';
