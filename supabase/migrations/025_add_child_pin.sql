-- Migration 025: Add child_pin column to parent_child_links
-- This allows parents to retrieve their child's PIN to send login credentials via email.

alter table public.parent_child_links
  add column if not exists child_pin text;

comment on column public.parent_child_links.child_pin is 'Child PIN stored for parent reference. Only accessible by the parent who created the link.';
