import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * GET /api/parent/check-flagged-messages
 * Check if there are any flagged messages in a chat for a parent with medium surveillance level
 * Uses service role to bypass RLS and check directly
 * Query params: chatId, parentId
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "").trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = createClient(supabaseUrl!, anonKey);
  const { data: { user }, error: authErr } = await client.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");
  const parentId = searchParams.get("parentId");

  if (!chatId || !parentId) {
    return NextResponse.json({ error: "Missing chatId or parentId" }, { status: 400 });
  }

  // Use service role to bypass RLS
  const admin = createServiceRoleClient();

  try {
    // Get all messages in the chat
    const { data: messages, error: messagesErr } = await admin
      .from("messages")
      .select("id")
      .eq("chat_id", chatId)
      .limit(100);

    if (messagesErr) {
      console.error("Error fetching messages:", messagesErr);
      return NextResponse.json({ error: "Error fetching messages" }, { status: 500 });
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ hasFlaggedMessages: false, messageCount: 0 });
    }

    const messageIds = messages.map(m => m.id);

    // Get parent's child ID
    const { data: parentLink, error: linkErr } = await admin
      .from("parent_child_links")
      .select("child_id")
      .eq("parent_id", parentId)
      .limit(1)
      .maybeSingle();

    if (linkErr) {
      console.error("Error fetching parent link:", linkErr);
      return NextResponse.json({ error: "Error fetching parent link" }, { status: 500 });
    }

    if (!parentLink) {
      return NextResponse.json({ hasFlaggedMessages: false, reason: "No parent link found" });
    }

    const childId = parentLink.child_id;

    // Get chat participants
    const { data: chat, error: chatErr } = await admin
      .from("chats")
      .select("user1_id, user2_id")
      .eq("id", chatId)
      .maybeSingle();

    if (chatErr || !chat) {
      console.error("Error fetching chat:", chatErr);
      return NextResponse.json({ error: "Error fetching chat" }, { status: 500 });
    }

    const otherChildId = chat.user1_id === childId ? chat.user2_id : chat.user1_id;

    // Check for flagged messages - check both children
    const { data: flaggedMessages, error: flaggedErr } = await admin
      .from("flagged_messages")
      .select("id, message_id, child_id, matched_keyword")
      .in("message_id", messageIds)
      .in("child_id", [childId, otherChildId])
      .limit(10);

    if (flaggedErr) {
      console.error("Error fetching flagged messages:", flaggedErr);
      return NextResponse.json({ error: "Error fetching flagged messages" }, { status: 500 });
    }

    const hasFlaggedMessages = flaggedMessages && flaggedMessages.length > 0;

    console.log("🔍 [API] Check flagged messages result:", {
      chatId,
      parentId,
      childId,
      otherChildId,
      messageCount: messageIds.length,
      flaggedCount: flaggedMessages?.length || 0,
      hasFlaggedMessages
    });

    return NextResponse.json({
      hasFlaggedMessages,
      flaggedCount: flaggedMessages?.length || 0,
      messageCount: messageIds.length
    });

  } catch (error) {
    console.error("Error in check-flagged-messages:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
