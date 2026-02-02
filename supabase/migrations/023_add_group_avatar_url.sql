-- Migration 023: Add avatar_url column to groups table
-- Allows groups to have profile pictures

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS avatar_url text;
