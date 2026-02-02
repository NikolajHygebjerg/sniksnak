# Phase 6: Parent controls – setup

You need **two** migrations for parent controls and child accounts.

## 1. Parent–child links and flags (003)

If you see **"Could not find the table 'public.parent_child_links' in the schema cache"**:

1. Open **Supabase Dashboard → SQL Editor → New query**.
2. Copy the **entire** contents of `supabase/migrations/003_phase6_parent_controls.sql`.
3. Paste and **Run**.
4. Refresh the app.

## 2. Child names / username column (004)

If you see **"Could not find the 'username' column of 'users' in the schema cache"** (or create-child / child login fails):

1. Open **Supabase Dashboard → SQL Editor → New query**.
2. Copy the **entire** contents of `supabase/migrations/004_child_username.sql`.
3. Paste and **Run**.
4. Refresh the app.

This adds a `username` column to `public.users` so child accounts use the child’s real name (no anonymous/incognito).

## Add a parent–child link (for testing)

In **SQL Editor**, run:

```sql
-- Replace YOUR_PARENT_USER_ID and YOUR_CHILD_USER_ID with actual UUIDs from auth.users or public.users
insert into public.parent_child_links (parent_id, child_id)
values (
  'YOUR_PARENT_USER_ID'::uuid,
  'YOUR_CHILD_USER_ID'::uuid
)
on conflict (parent_id, child_id) do nothing;
```

To find user IDs: **Supabase Dashboard → Authentication → Users** (or query `select id, email from public.users`).

## Parent view (children cannot see it)

Child accounts (users with a `username` set) cannot access the parent dashboard. If they open `/parent` or any `/parent/*` URL, they are redirected to `/chats`. Parents go straight to the dashboard with no code required.

## Child contact approvals (someone unknown wants to chat)

When someone starts a chat with a child, the parent must accept before the child sees the chat or messages.

1. Run **migration 007** in Supabase SQL Editor:  
   `supabase/migrations/007_child_contact_approvals.sql`  
   This creates `parent_approved_contacts` and `pending_contact_requests`.

2. **Flow:**  
   - User A starts a chat with child B. The chat is created and a **pending contact request** is added.  
   - The parent sees “Chat requests” on the parent dashboard: “**Contact name** wants to chat with **Child name**”.  
   - Parent clicks **Accept** → the contact is added to approved contacts; the child then sees the chat and messages.  
   - Parent clicks **Reject** → the request is removed; the child never sees that chat.

3. **Child app:** The “Parent view” link is hidden for child accounts. Children only see chats with contacts the parent has approved.
