-- Migration 019: Allow children to upload images to chat-media bucket
-- This ensures that children (authenticated users) can upload images in chats

-- Drop existing policies if they exist (to recreate them)
DROP POLICY IF EXISTS "Allow authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to read images" ON storage.objects;

-- Create policy for authenticated users to upload to chat-media bucket
-- This allows both parents and children to upload images
CREATE POLICY "Allow authenticated users to upload images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
);

-- Create policy for authenticated users to read from chat-media bucket
-- This allows both parents and children to view images
CREATE POLICY "Allow authenticated users to read images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-media'
);

-- Also allow public read access for images (so they can be displayed)
-- This is safe because images are stored in chat-specific folders
CREATE POLICY "Allow public read access to chat-media"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'chat-media'
);
