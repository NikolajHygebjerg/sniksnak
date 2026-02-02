# Sikker Chat System User Setup

## Overview
The keyword scanner sends notifications to parents via a system user called "Sikker chat" (Safe chat). This user needs to be created manually in Supabase.

## Setup Steps

1. **Create Auth User** (if needed):
   - Go to Supabase Dashboard → Authentication → Users
   - Create a new user with:
     - Email: `sikker-chat@system.local`
     - Password: (generate a secure random password, you won't need it)
     - Copy the User ID (UUID)

2. **Create User Record**:
   - Go to Supabase Dashboard → SQL Editor
   - Run this SQL (replace `USER_ID_FROM_AUTH` with the UUID from step 1):
     ```sql
     INSERT INTO public.users (id, email)
     VALUES ('USER_ID_FROM_AUTH', 'sikker-chat@system.local')
     ON CONFLICT (id) DO NOTHING;
     ```

   OR use the hardcoded UUID `49c8274a-c157-0000-0000-000000000001` (expanded from 49c8274ac157):
   ```sql
   -- First create auth user with this specific UUID, then:
   INSERT INTO public.users (id, email)
   VALUES ('49c8274a-c157-0000-0000-000000000001', 'sikker-chat@system.local')
   ON CONFLICT (id) DO NOTHING;
   ```

## How It Works

When a child receives a message containing flagged keywords:
1. The message is flagged in `flagged_messages` table
2. The system finds the recipient child's parent(s)
3. A chat is created/found between the parent and "Sikker chat"
4. A notification message is sent from "Sikker chat" to the parent
5. The parent can click the link in the message to view the flagged chat

## Testing

To test:
1. Send a message containing "jeg hader dig" from Child B to Child E
2. Check that Child E's parent receives a message from "Sikker chat"
3. The message should contain a link to view the chat
