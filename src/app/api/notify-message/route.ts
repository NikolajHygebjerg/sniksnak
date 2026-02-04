import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail =
  process.env.RESEND_FROM_EMAIL ?? "Chat App <onboarding@resend.dev>";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * POST /api/notify-message
 * 1) Direct: { recipient_email, sender_email, content_preview?, chat_id? }
 * 2) Supabase webhook: { type: "INSERT", table: "messages", record: { id, chat_id, sender_id, content, ... } }
 *    Looks up recipient from chat and users, then sends email.
 * Env: RESEND_API_KEY, optional RESEND_FROM_EMAIL, SUPABASE_SERVICE_ROLE_KEY (for webhook), NEXT_PUBLIC_SUPABASE_URL
 */
export async function POST(request: NextRequest) {
  if (!resendApiKey) {
    return NextResponse.json(
      {
        error:
          "RESEND_API_KEY not set. Add to .env.local and run: npm install resend",
      },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let recipient_email: string;
  let sender_email: string;
  let content_preview: string;
  let chat_id: string | undefined;
  let storedRecipientId: string | undefined;

  if (body.record && body.table === "messages") {
    const record = body.record as {
      chat_id: string;
      sender_id: string;
      content?: string | null;
    };
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL required for webhook" },
        { status: 503 }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: chat } = await supabase
      .from("chats")
      .select("user1_id, user2_id")
      .eq("id", record.chat_id)
      .single();
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    const recipientId =
      record.sender_id === chat.user1_id ? chat.user2_id : chat.user1_id;
    const { data: senderUser } = await supabase
      .from("users")
      .select("email, first_name, surname, username")
      .eq("id", record.sender_id)
      .single();
    const { data: recipientUser } = await supabase
      .from("users")
      .select("email")
      .eq("id", recipientId)
      .single();
    if (!recipientUser?.email) {
      return NextResponse.json(
        { error: "Recipient user or email not found" },
        { status: 404 }
      );
    }
    recipient_email = recipientUser.email;
    sender_email = (senderUser?.email as string) ?? "Someone";
    content_preview = (record.content as string) ?? "";
    chat_id = record.chat_id;
    storedRecipientId = recipientId;
  } else {
    const r = body as {
      recipient_email?: string;
      sender_email?: string;
      content_preview?: string;
      chat_id?: string;
    };
    if (!r.recipient_email || !r.sender_email) {
      return NextResponse.json(
        { error: "recipient_email and sender_email required" },
        { status: 400 }
      );
    }
    recipient_email = r.recipient_email;
    sender_email = r.sender_email;
    content_preview = r.content_preview ?? "";
    chat_id = r.chat_id;
  }

  const resend = new Resend(resendApiKey);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const chatPath = chat_id ? `/chats/${chat_id}` : "/chats";
  const preview =
    content_preview.slice(0, 100) + (content_preview.length > 100 ? "…" : "") ||
    "New message";

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: recipient_email,
    subject: `New message from ${sender_email}`,
    html: `
      <p>You have a new message from <strong>${escapeHtml(sender_email)}</strong>.</p>
      <p>${escapeHtml(preview)}</p>
      <p><a href="${appUrl}${chatPath}">Open chat</a></p>
    `,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also send push notification if VAPID keys are configured
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  
  if (vapidPublicKey && vapidPrivateKey && chat_id && body.record && body.table === "messages") {
    try {
      const record = body.record as {
        chat_id: string;
        sender_id: string;
        content?: string | null;
      };
      
      // Get sender user info for notification
      const { data: senderUser } = await supabase
        .from("users")
        .select("first_name, surname, username, email")
        .eq("id", record.sender_id)
        .single();

      const senderName = senderUser?.first_name && senderUser?.surname
        ? `${senderUser.first_name} ${senderUser.surname}`
        : senderUser?.username || senderUser?.email || "Nogen";

      const messagePreview = (record.content || "").slice(0, 100) + ((record.content?.length || 0) > 100 ? "…" : "") || "Ny besked";

      // Send push notification to recipient
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const pushResponse = await fetch(`${appUrl}/api/push/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-key': supabaseServiceKey || '',
        },
        body: JSON.stringify({
          userId: storedRecipientId,
          title: `Ny besked fra ${senderName}`,
          body: messagePreview,
          chatId: chat_id,
          url: `/chats/${chat_id}`,
          tag: `chat-${chat_id}`,
        }),
      });

      if (!pushResponse.ok) {
        const errorText = await pushResponse.text();
        console.warn('Push notification failed:', errorText);
      }
    } catch (pushError) {
      // Don't fail the request if push notification fails
      console.warn('Error sending push notification:', pushError);
    }
  }

  return NextResponse.json({ ok: true });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
