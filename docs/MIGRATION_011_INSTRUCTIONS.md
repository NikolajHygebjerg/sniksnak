# Migration 011: Add is_child Column - Instructions

## Overview
This migration adds an `is_child` boolean column to the `users` table to distinguish child users from parents. This enables the "Find children" search feature to work correctly.

## Steps to Run Migration

### Option 1: Supabase Dashboard (Recommended)

1. **Open Supabase Dashboard**
   - Go to your Supabase project dashboard
   - Navigate to **SQL Editor** (left sidebar)

2. **Create New Query**
   - Click **"New query"** button

3. **Copy Migration SQL**
   - Open the file: `supabase/migrations/011_add_is_child_column.sql`
   - Copy the entire contents

4. **Paste and Execute**
   - Paste the SQL into the SQL Editor
   - Click **"Run"** or press `Ctrl+Enter` (Windows/Linux) or `Cmd+Enter` (Mac)

5. **Verify Success**
   - You should see "Success. No rows returned" or similar success message
   - Verify the column was added by running:
     ```sql
     SELECT column_name, data_type, column_default 
     FROM information_schema.columns 
     WHERE table_name = 'users' AND column_name = 'is_child';
     ```
   - You should see a row with `is_child`, `boolean`, `false`

6. **Verify Children Updated**
   - Check that existing children have `is_child = true`:
     ```sql
     SELECT id, email, username, is_child 
     FROM users 
     WHERE is_child = true;
     ```

### Option 2: Supabase CLI (If Available)

If you have Supabase CLI set up:

```bash
cd /Users/nikolajhygebjerg/Projects/ChatApp
supabase db push
```

## What This Migration Does

1. **Adds `is_child` column** to `users` table (default: `false`)
2. **Creates index** on `is_child` for efficient filtering
3. **Updates existing children**:
   - Sets `is_child = true` for all users in `parent_child_links` table
   - Sets `is_child = true` for all users with non-empty `username`
4. **Creates RLS policy** "Children can discover other children" for the search feature

## Troubleshooting

### If migration fails:
- Check if column already exists: `SELECT * FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_child';`
- If it exists, the migration will skip adding it (uses `IF NOT EXISTS`)
- Check console for specific error messages

### If search still doesn't work:
- Check browser console for errors
- Verify the column exists (see verification query above)
- Check that children have `is_child = true` set correctly
- The frontend has fallback logic that uses username check if column doesn't exist

## After Migration

Once the migration is complete:
1. Refresh your app
2. Try the "Find children" search feature
3. It should now work correctly with the `is_child` column

The frontend code will automatically use the `is_child` column if it exists, or fall back to username checking if it doesn't.
