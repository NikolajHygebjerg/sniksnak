-- Migration 026: Allow contacts to delete their own pending contact requests
-- This allows users to withdraw friend requests they sent before they are approved by parents.

-- Allow contacts (the person who sent the request) to delete their own pending requests
create policy "Contacts can delete their own pending requests"
  on public.pending_contact_requests for delete
  to authenticated
  using (contact_user_id = auth.uid());

-- Allow contacts to view their own pending requests (so they can see what they sent)
create policy "Contacts can view their own pending requests"
  on public.pending_contact_requests for select
  to authenticated
  using (contact_user_id = auth.uid());

comment on policy "Contacts can delete their own pending requests" on public.pending_contact_requests is 'Allows users to withdraw friend requests they sent before parent approval.';
