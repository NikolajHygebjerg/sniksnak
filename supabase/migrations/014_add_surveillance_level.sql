-- ============================================================
-- Add surveillance level to parent_child_links
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Adds surveillance_level column to allow parents to choose monitoring level:
-- - 'strict': Access to child's chats and pictures
-- - 'medium': Notifications when explicit language is used (and then access to chat)
-- - 'mild': Only receive messages when child flags a bad message
-- ============================================================

-- Add surveillance_level column with default 'medium' (backward compatible)
alter table public.parent_child_links
  add column if not exists surveillance_level text not null default 'medium'
  check (surveillance_level in ('strict', 'medium', 'mild'));

-- Create index for efficient filtering
create index if not exists parent_child_links_surveillance_level 
  on public.parent_child_links(surveillance_level);

-- Update existing links to 'medium' if they don't have a level set
-- (This ensures backward compatibility - existing parents get medium monitoring)
update public.parent_child_links
set surveillance_level = 'medium'
where surveillance_level is null or surveillance_level = '';

-- Add comment for documentation
comment on column public.parent_child_links.surveillance_level is 
  'Monitoring level: strict (full access), medium (keyword notifications + access), mild (only child flags)';
