# Chat App – Setup & optional features

## 1. Run the schema migration (chat list + unread + attachments)

In **Supabase Dashboard → SQL Editor**, run the contents of:

- `supabase/schema.sql` (if you haven’t already)
- `supabase/migrations/002_chat_reads_and_attachments.sql`

This adds:

- **chat_reads** – last read time per user per chat (for unread counts)
- **messages.attachment_url**, **messages.attachment_type** – optional image/attachment
- **messages.content** – now nullable (for image-only messages)

## 2. Storage bucket (image sharing)

The app uses the **chat-media** bucket for chat images and child profile photos. You can either create it manually or let the app create it:

- **Auto-created:** When a parent creates a child account (with photo), the API will create the `chat-media` bucket if it doesn’t exist (using the service role). No manual step needed if Storage is enabled in your project.
- **Manual:** **Supabase Dashboard → Storage → New bucket**
  1. Name: `chat-media`
  2. Public: **ON**
  3. **Policies** for `chat-media`:
     - **Insert**: “Allow authenticated upload” – `bucket_id = 'chat-media'` for `authenticated`
     - **Select**: “Allow authenticated read” – `bucket_id = 'chat-media'` for `authenticated`

If photo upload fails, ensure **Storage** is enabled in your Supabase project (Dashboard → Project Settings → API) and that the bucket exists or can be created by the service role.

## 3. Email notifications (new message)

1. **Resend**: Sign up at [resend.com](https://resend.com), get an API key.
2. In `.env.local` add:
   - `RESEND_API_KEY=re_xxxx`
   - Optional: `RESEND_FROM_EMAIL=Chat App <notifications@yourdomain.com>` (or use Resend’s onboarding address)
   - `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API) – needed for webhook to look up recipient
   - `NEXT_PUBLIC_APP_URL` – your app URL (e.g. `https://yourapp.vercel.app`) for “Open chat” links
3. Install: `npm install resend`
4. **Supabase Database Webhook** (optional):  
   **Database → Webhooks → Create**  
   - Table: `messages`  
   - Events: **Insert**  
   - URL: `https://your-app.vercel.app/api/notify-message` (or your API URL)  
   - Headers: none needed if you don’t use auth  
   - Payload: send the new row (Supabase sends `type`, `table`, `record`; the API uses `record` to find the recipient and send the email)

Manual test: `POST /api/notify-message` with body:

```json
{
  "recipient_email": "recipient@example.com",
  "sender_email": "sender@example.com",
  "content_preview": "Hello!",
  "chat_id": "optional-uuid"
}
```

## 4. Push notifications (optional)

For browser push when a new message arrives:

1. **VAPID keys**: Generate a key pair (e.g. with `web-push`) and store the public key in your app and the private key in env.
2. **Service worker**: Register a worker that subscribes to push and shows a notification when the app receives a push payload.
3. **Backend**: When a message is inserted (e.g. same webhook as email), call a push service (e.g. web-push) to send a notification to the recipient’s subscription.

This is not implemented in the app; the email webhook and Resend setup above are enough for “new message” alerts via email.

## 5. Summary

| Feature              | Requires |
|----------------------|----------|
| Chat list + unread   | Migration 002 |
| Image sharing        | `chat-media` bucket + policies |
| Email on new message | Resend API key, env vars, optional DB webhook |
| Typing indicators    | Nothing extra (Realtime presence) |
| Mobile + a11y        | Nothing extra (built-in) |
