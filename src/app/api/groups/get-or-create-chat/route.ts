import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * POST /api/groups/get-or-create-chat
 * Get or create a chat for a group
 * Body: { groupId: string }
 */
export async function POST(request: NextRequest) {
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

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const groupId = typeof body?.groupId === "string" ? body.groupId.trim() : "";
  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Verify user is a member of the group
  const { data: membership } = await admin
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "You are not a member of this group" }, { status: 403 });
  }

  // Check if chat already exists for this group
  const { data: existingChat } = await admin
    .from("chats")
    .select("id")
    .eq("group_id", groupId)
    .maybeSingle();

  if (existingChat) {
    return NextResponse.json({ ok: true, chatId: existingChat.id });
  }

  // Create new group chat
  // For group chats, we'll use user1_id = user2_id = first member's ID (or a placeholder)
  // The group_id will identify it as a group chat
  const { data: firstMember } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const placeholderUserId = firstMember?.user_id || user.id;

  const { data: newChat, error: chatErr } = await admin
    .from("chats")
    .insert({
      user1_id: placeholderUserId,
      user2_id: placeholderUserId, // Same user for group chats
      group_id: groupId,
    })
    .select("id")
    .maybeSingle();

  if (chatErr || !newChat) {
    console.error("Error creating group chat:", chatErr);
    return NextResponse.json({ error: "Failed to create group chat" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, chatId: newChat.id });
}
