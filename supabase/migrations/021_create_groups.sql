-- Migration 021: Create groups functionality for children
-- Allows children to create groups and invite friends

-- Groups table
CREATE TABLE IF NOT EXISTS public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  avatar_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS groups_created_by ON public.groups(created_by);
CREATE INDEX IF NOT EXISTS groups_created_at ON public.groups(created_at);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- Group members table (who is in which group)
CREATE TABLE IF NOT EXISTS public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_group_id ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS group_members_user_id ON public.group_members(user_id);

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Group invitations table (pending invitations)
CREATE TABLE IF NOT EXISTS public.group_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  invited_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(group_id, invited_user_id)
);

CREATE INDEX IF NOT EXISTS group_invitations_group_id ON public.group_invitations(group_id);
CREATE INDEX IF NOT EXISTS group_invitations_invited_user_id ON public.group_invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS group_invitations_status ON public.group_invitations(status);

ALTER TABLE public.group_invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for groups
-- Children can see groups they are members of
CREATE POLICY "Children can view groups they are members of"
  ON public.groups FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members
      WHERE group_members.group_id = groups.id
        AND group_members.user_id = auth.uid()
    )
  );

-- Children can create groups (only if they are a child - has username)
CREATE POLICY "Children can create groups"
  ON public.groups FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users
      WHERE users.id = auth.uid()
        AND users.username IS NOT NULL
        AND users.username != ''
    )
    AND created_by = auth.uid()
  );

-- Group creator is automatically admin
-- Children can update groups they created
CREATE POLICY "Group creators can update their groups"
  ON public.groups FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- RLS Policies for group_members
-- Children can see members of groups they are in
-- Simplified: Users can see group_members rows where they are the user_id OR where they are a member of the group
CREATE POLICY "Children can view members of their groups"
  ON public.group_members FOR SELECT
  TO authenticated
  USING (
    -- Can see their own membership
    user_id = auth.uid()
    OR
    -- Can see other members if they are also a member of the same group
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = group_members.group_id
        AND gm.user_id = auth.uid()
    )
  );

-- Group admins can add members
-- Also allow group creator to add themselves as admin (for initial group creation)
CREATE POLICY "Group admins can add members"
  ON public.group_members FOR INSERT
  TO authenticated
  WITH CHECK (
    -- If user is already an admin of the group
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = group_members.group_id
        AND gm.user_id = auth.uid()
        AND gm.role = 'admin'
    )
    OR
    -- Or if the group creator is adding themselves as admin (for initial creation)
    (
      EXISTS (
        SELECT 1
        FROM public.groups g
        WHERE g.id = group_members.group_id
          AND g.created_by = auth.uid()
      )
      AND group_members.user_id = auth.uid()
      AND group_members.role = 'admin'
    )
  );

-- Group admins can remove members (except themselves)
CREATE POLICY "Group admins can remove members"
  ON public.group_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = group_members.group_id
        AND gm.user_id = auth.uid()
        AND gm.role = 'admin'
    )
    AND user_id != auth.uid() -- Cannot remove yourself
  );

-- RLS Policies for group_invitations
-- Children can see invitations sent to them or sent by them
CREATE POLICY "Children can view their invitations"
  ON public.group_invitations FOR SELECT
  TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR invited_by = auth.uid()
  );

-- Group admins can create invitations
CREATE POLICY "Group admins can create invitations"
  ON public.group_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = group_invitations.group_id
        AND gm.user_id = auth.uid()
        AND gm.role = 'admin'
    )
    AND invited_by = auth.uid()
  );

-- Invited users can update their invitation status
CREATE POLICY "Invited users can accept/reject invitations"
  ON public.group_invitations FOR UPDATE
  TO authenticated
  USING (invited_user_id = auth.uid())
  WITH CHECK (invited_user_id = auth.uid());

-- Add group_id to chats table for group chats
ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS chats_group_id ON public.chats(group_id);

-- Update chats RLS to allow group members to see group chats
-- (This will be handled by existing policies + group membership check in application code)
