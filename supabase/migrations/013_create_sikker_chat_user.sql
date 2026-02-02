-- ============================================================
-- Create Sikker Chat system user for safety notifications
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- This creates a system user that sends safety notifications to parents
-- when their children receive messages containing flagged keywords.
-- ============================================================

-- UUID: 13afd8bf-90a6-49b9-b38e-49c8274ac157
-- IMPORTANT: Make sure this UUID exists in auth.users first!
-- This user should already exist in auth.users if you created it via Supabase Dashboard

-- Create the user record
INSERT INTO public.users (id, email)
VALUES ('13afd8bf-90a6-49b9-b38e-49c8274ac157', 'sikker-chat@system.local')
ON CONFLICT (id) DO NOTHING;

-- Add a username/first_name for display purposes
UPDATE public.users
SET 
  first_name = 'Sikker',
  surname = 'Chat',
  username = 'Sikker Chat'
WHERE id = '13afd8bf-90a6-49b9-b38e-49c8274ac157';

-- Verify the user was created
SELECT id, email, first_name, surname, username 
FROM public.users 
WHERE id = '13afd8bf-90a6-49b9-b38e-49c8274ac157';
