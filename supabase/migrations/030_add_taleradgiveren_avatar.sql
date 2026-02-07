-- ============================================================
-- Add avatar for Talerådgiveren
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- This updates the Talerådgiveren user to include an avatar URL
-- ============================================================

-- Update Talerådgiveren user with avatar URL (always set, even if already set)
UPDATE public.users
SET avatar_url = '/taleradgiveren-avatar.png'
WHERE id = '945d9864-7118-487b-addb-1dd1e821bc30';

-- Verify the avatar was set
SELECT id, email, first_name, surname, username, avatar_url 
FROM public.users 
WHERE id = '945d9864-7118-487b-addb-1dd1e821bc30';
