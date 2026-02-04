# Talerådgiveren Setup Guide

Talerådgiveren er en system user der sender prædefinerede rådgivningsbeskeder til børn når deres beskeder bliver flagged.

## Trin 1: Opret Talerådgiveren Auth User

1. Gå til **Supabase Dashboard** → **Authentication** → **Users**
2. Klik **"Add User"** eller **"Create User"**
3. Fill in:
   - **Email**: `taleradgiveren@system.local`
   - **Password**: Generer et sikkert tilfældigt password (du skal ikke logge ind med dette)
   - **Auto Confirm User**: ✅ (check dette)
4. Klik **"Create User"**
5. **IMPORTANT**: Kopiér **User ID (UUID)** - det skal være: `945d9864-7118-487b-addb-1dd1e821bc30`
   - Hvis UUID'en er anderledes, opdater `.env.local` med den korrekte UUID

## Trin 2: Kør Migration

1. Gå til **Supabase Dashboard** → **SQL Editor**
2. Kør migration filen: `supabase/migrations/028_create_taleradgiveren_user.sql`

Eller kopiér og kør dette SQL direkte (håndterer hvis username allerede findes):

```sql
-- Create the user record (if it doesn't exist)
INSERT INTO public.users (id, email)
VALUES ('945d9864-7118-487b-addb-1dd1e821bc30', 'taleradgiveren@system.local')
ON CONFLICT (id) DO NOTHING;

-- Update user, håndterer hvis username allerede findes
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
    WHERE id = '945d9864-7118-487b-addb-1dd1e821bc30';
  END IF;
END $$;

-- Verify
SELECT id, email, first_name, surname, username, avatar_url 
FROM public.users 
WHERE id = '945d9864-7118-487b-addb-1dd1e821bc30';
```

**Eller kør migrationen for at tilføje avatar:**
1. Kør migration filen: `supabase/migrations/030_add_taleradgiveren_avatar.sql`
2. Dette opdaterer Talerådgiveren med avatar URL: `/taleradgiveren-avatar.png`

## Trin 3: Tjek Environment Variabler

Sørg for at `.env.local` indeholder:

```bash
TALERADGIVEREN_USER_ID=945d9864-7118-487b-addb-1dd1e821bc30
NEXT_PUBLIC_TALERADGIVEREN_USER_ID=945d9864-7118-487b-addb-1dd1e821bc30
```

## Trin 4: Test

1. Log ind som et barn
2. Send en besked med et keyword (fx "slå" eller "jeg hader dig")
3. Talerådgiveren skulle automatisk:
   - Oprette en chat med barnet (hvis den ikke findes)
   - Sende en prædefineret rådgivningsbesked
   - Vise chatten i chat listen (selvom den ikke er i approved contacts)

## Troubleshooting

### Talerådgiveren vises ikke i chat listen

- Tjek at `NEXT_PUBLIC_TALERADGIVEREN_USER_ID` er sat i `.env.local`
- Genstart Next.js serveren efter at have opdateret `.env.local`
- Hard refresh browseren (Cmd+Shift+R eller Ctrl+Shift+R)

### Talerådgiveren sender ikke beskeder

- Tjek server logs for fejl
- Tjek at Talerådgiveren user findes i databasen:
  ```sql
  SELECT id, email, first_name, surname, username 
  FROM public.users 
  WHERE id = '945d9864-7118-487b-addb-1dd1e821bc30';
  ```
- Tjek at `TALERADGIVEREN_USER_ID` er sat i `.env.local`

### "Talerådgiveren user not found" fejl

- Sørg for at Auth user er oprettet først (Trin 1)
- Kør migration (Trin 2)
- Tjek at UUID'en matcher i både Auth og database
