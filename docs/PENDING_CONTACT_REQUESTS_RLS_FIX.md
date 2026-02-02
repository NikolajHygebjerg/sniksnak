# Fix RLS for pending_contact_requests

## Problem
When inserting into `pending_contact_requests`, you get:
```
ERROR: new row violates row-level security policy for table "pending_contact_requests"
```

## Solution

Run this SQL in Supabase SQL Editor:

```sql
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Contacts can create pending request (they started chat with child)" 
ON public.pending_contact_requests;

DROP POLICY IF EXISTS "Contacts can update pending request (they started chat with child)" 
ON public.pending_contact_requests;

-- Create INSERT policy that allows authenticated users to insert when:
-- 1. They are the contact_user_id (the one starting the chat)
-- 2. OR they are the parent of the child_id (parent can create requests on behalf of child)
CREATE POLICY "Contacts can create pending request (they started chat with child)"
  ON public.pending_contact_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if current user is the contact (starting the chat)
    contact_user_id = auth.uid()
    OR
    -- Allow if current user is a parent of the child (parent creating request)
    EXISTS (
      SELECT 1 FROM public.parent_child_links pcl
      WHERE pcl.parent_id = auth.uid() 
      AND pcl.child_id = pending_contact_requests.child_id
    )
  );

-- Create UPDATE policy for upsert to work
CREATE POLICY "Contacts can update pending request (they started chat with child)"
  ON public.pending_contact_requests FOR UPDATE
  TO authenticated
  USING (
    contact_user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.parent_child_links pcl
      WHERE pcl.parent_id = auth.uid() 
      AND pcl.child_id = pending_contact_requests.child_id
    )
  )
  WITH CHECK (
    contact_user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.parent_child_links pcl
      WHERE pcl.parent_id = auth.uid() 
      AND pcl.child_id = pending_contact_requests.child_id
    )
  );
```

## Correct INSERT Statement

```sql
-- Example: User A (contact_user_id) wants to chat with Child B (child_id)
INSERT INTO public.pending_contact_requests 
  (child_id, contact_user_id, chat_id, created_at) 
VALUES 
  ('CHILD_B_UUID', 'USER_A_UUID', 'CHAT_UUID', NOW());

-- Or let created_at use default:
INSERT INTO public.pending_contact_requests 
  (child_id, contact_user_id, chat_id) 
VALUES 
  ('CHILD_B_UUID', 'USER_A_UUID', 'CHAT_UUID');
```

## Notes

- `child_id`: The UUID of the child who will receive the request
- `contact_user_id`: The UUID of the user starting the chat (must be `auth.uid()` for RLS to allow)
- `chat_id`: The UUID of the chat that was created
- `created_at`: Optional, defaults to `NOW()` if not provided

## Testing

After running the policy, test with:

```sql
-- This should work if you're authenticated as USER_A_UUID
INSERT INTO public.pending_contact_requests 
  (child_id, contact_user_id, chat_id) 
VALUES 
  ('CHILD_B_UUID', auth.uid(), 'CHAT_UUID');
```
