# Migration Instructions: Surveillance Levels

## Overview
This adds a surveillance level system that allows parents to choose their level of monitoring when adding a child:
- **Strict**: Access to your child's chats and pictures
- **Medium**: Notifications when explicit language is used (and then access to the chat)
- **Mild**: Only receive messages when your child flags a bad message

## Step 1: Run Migration 014
1. Open Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `supabase/migrations/014_add_surveillance_level.sql`
3. Run the migration
4. Verify: Check that the `parent_child_links` table now has a `surveillance_level` column

## Step 2: Run Migration 015
1. In Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `supabase/migrations/015_update_rls_for_surveillance_levels.sql`
3. Run the migration
4. Verify: Check that the RLS policies for `chats` and `messages` have been updated

## How It Works

### Strict Level
- Parents can view all chats and messages involving their child
- Keyword scanning is enabled
- Full access to chat history

### Medium Level
- Parents receive notifications when explicit language is detected
- After receiving a notification, parents can access the specific chat via the link
- Keyword scanning is enabled
- No direct access to chats without a notification

### Mild Level
- Parents do NOT receive keyword notifications
- Parents can only see chats when the child manually flags a message
- No keyword scanning
- No direct chat access

## Testing
1. Create a child with "Strict" level - parent should see all chats
2. Create a child with "Medium" level - parent should only see chats after keyword notification
3. Create a child with "Mild" level - parent should not see chats unless child flags a message
4. Test keyword scanning - it should only work for "Strict" and "Medium" levels
