-- ============================================================
-- Create Talerådgiveren system user for counseling messages
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- This creates a system user that sends counseling messages to children
-- when their messages are flagged for safety concerns.
-- ============================================================

-- UUID: 945d9864-7118-487b-addb-1dd1e821bc30
-- IMPORTANT: Make sure this UUID exists in auth.users first!
-- This user should already exist in auth.users if you created it via Supabase Dashboard

-- Create the user record (if it doesn't exist)
INSERT INTO public.users (id, email)
VALUES ('945d9864-7118-487b-addb-1dd1e821bc30', 'taleradgiveren@system.local')
ON CONFLICT (id) DO NOTHING;

-- Update user with display name
-- Håndterer hvis username allerede findes ved at bruge first_name i stedet
DO $$
DECLARE
  existing_username_user_id uuid;
BEGIN
  -- Check if username is taken by another user
  SELECT id INTO existing_username_user_id
  FROM public.users
  WHERE username = 'Talerådgiveren' AND id != '945d9864-7118-487b-addb-1dd1e821bc30';
  
  IF existing_username_user_id IS NULL THEN
    -- Username is available, update the user
    UPDATE public.users
    SET 
      first_name = 'Talerådgiveren',
      surname = '',
      username = 'Talerådgiveren'
    WHERE id = '945d9864-7118-487b-addb-1dd1e821bc30';
  ELSE
    -- Username is taken, use first_name only (username can be null)
    UPDATE public.users
    SET 
      first_name = 'Talerådgiveren',
      surname = ''
      -- Don't set username if it's already taken by another user
    WHERE id = '945d9864-7118-487b-addb-1dd1e821bc30';
    
    RAISE NOTICE 'Username "Talerådgiveren" is already taken by user %. Using first_name only.', existing_username_user_id;
  END IF;
END $$;

-- Verify the user was created/updated
SELECT id, email, first_name, surname, username 
FROM public.users 
WHERE id = '945d9864-7118-487b-addb-1dd1e821bc30';
