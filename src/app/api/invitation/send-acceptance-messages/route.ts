import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Display name for a user row */
function displayName(u: { first_name?: string | null; surname?: string | null; username?: string | null; email?: string | null }): string {
  if (u.first_name != null && u.surname != null && (u.first_name.trim() || u.surname.trim())) {
    const f = (u.first_name as string).trim() || "?";
    const s = (u.surname as string).trim() || "?";
    const cap = (x: string) => x.slice(0, 1).toUpperCase() + x.slice(1).toLowerCase();
    return `${cap(f)} ${cap(s)}`;
  }
  if ((u.username as string)?.trim()) return (u.username as string).trim();
  return (u.email as string) ?? "Unknown";
}

/**
 * POST /api/invitation/send-acceptance-messages
 * Called when Parent B accepts an invitation. Sends confirmation messages to:
 * 1. Child B (the invited child) - in their chat with Child A
 * 2. Parent B (the accepting parent) - in the parent-parent chat
 * Body: { inviting_child_id: string, invited_child_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!token || !supabaseUrl) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: { user: caller }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !caller) {
      console.error("Auth error:", authErr);
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    let invitingChildId: string;
    let invitedChildId: string;
    try {
      const body = await request.json();
      invitingChildId = typeof body?.inviting_child_id === "string" ? body.inviting_child_id.trim() : "";
      invitedChildId = typeof body?.invited_child_id === "string" ? body.invited_child_id.trim() : "";
      if (!invitingChildId || !invitedChildId) {
        return NextResponse.json({ error: "Missing inviting_child_id or invited_child_id" }, { status: 400 });
      }
    } catch (err) {
      console.error("JSON parse error:", err);
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const admin = createServiceRoleClient();

    // Get child names
    const { data: childA, error: childAErr } = await admin.from("users").select("id, email, username, first_name, surname").eq("id", invitingChildId).single();
    if (childAErr || !childA) {
      console.error("Error fetching child A:", childAErr);
      return NextResponse.json({ error: `Failed to fetch inviting child: ${childAErr?.message || "Not found"}` }, { status: 404 });
    }
    const { data: childB, error: childBErr } = await admin.from("users").select("id, email, username, first_name, surname").eq("id", invitedChildId).single();
    if (childBErr || !childB) {
      console.error("Error fetching child B:", childBErr);
      return NextResponse.json({ error: `Failed to fetch invited child: ${childBErr?.message || "Not found"}` }, { status: 404 });
    }
    const nameA = displayName(childA);
    const nameB = displayName(childB);

    // Get both parents (Parent A = inviting child's parent, Parent B = invited child's parent)
    const { data: linkA, error: linkAErr } = await admin
      .from("parent_child_links")
      .select("parent_id")
      .eq("child_id", invitingChildId)
      .limit(1)
      .maybeSingle();
    if (linkAErr) {
      console.error("Error fetching parent link A:", linkAErr);
      return NextResponse.json({ error: `Failed to fetch parent link: ${linkAErr.message}` }, { status: 500 });
    }
    const parentAId = linkA?.parent_id;
    if (!parentAId) {
      return NextResponse.json({ ok: false, message: "Inviting child has no linked parent" }, { status: 404 });
    }

    const { data: linkB, error: linkBErr } = await admin
      .from("parent_child_links")
      .select("parent_id")
      .eq("child_id", invitedChildId)
      .limit(1)
      .maybeSingle();
    if (linkBErr) {
      console.error("Error fetching parent link B:", linkBErr);
      return NextResponse.json({ error: `Failed to fetch parent link: ${linkBErr.message}` }, { status: 500 });
    }
    const parentBId = linkB?.parent_id;
    if (!parentBId) {
      return NextResponse.json({ error: "Invited child has no linked parent" }, { status: 404 });
    }

    // Verify caller is either Parent A or Parent B
    if (caller.id !== parentAId && caller.id !== parentBId) {
      return NextResponse.json({ error: "Unauthorized: you are not a parent in this invitation" }, { status: 403 });
    }

    // 1. Send message to Child B in their chat with Child A
    const [childChatU1, childChatU2] = [invitingChildId, invitedChildId].sort();
    const { data: childChat, error: childChatErr } = await admin
      .from("chats")
      .select("id")
      .eq("user1_id", childChatU1)
      .eq("user2_id", childChatU2)
      .maybeSingle();
    
    if (childChatErr) {
      console.error("Error fetching child chat:", childChatErr);
      return NextResponse.json({ error: `Failed to fetch child chat: ${childChatErr.message}` }, { status: 500 });
    }
    
    if (childChat?.id) {
      const messageToChildB = `✅ Connection approved! You can now chat with ${nameA}. Your parent has approved this connection.`;
      const { error: msgErr } = await admin.from("messages").insert({
        chat_id: childChat.id,
        sender_id: invitingChildId, // From Child A (the one who initiated)
        content: messageToChildB,
      }).select("id").single();
      if (msgErr) {
        console.error("Failed to send message to Child B:", msgErr);
        return NextResponse.json({ error: `Failed to send message to Child B: ${msgErr.message}` }, { status: 500 });
      }
      console.log("Message sent to Child B in chat:", childChat.id);
    } else {
      console.warn(`Child chat not found for ${invitingChildId} and ${invitedChildId}`);
      return NextResponse.json({ error: "Child chat not found" }, { status: 404 });
    }

    // 2. Send confirmation message to Parent B in the parent-parent chat
    const [parentChatU1, parentChatU2] = [parentAId, parentBId].sort();
    const { data: parentChat, error: parentChatErr } = await admin
      .from("chats")
      .select("id")
      .eq("user1_id", parentChatU1)
      .eq("user2_id", parentChatU2)
      .maybeSingle();
    
    if (parentChatErr) {
      console.error("Error fetching parent chat:", parentChatErr);
      return NextResponse.json({ error: `Failed to fetch parent chat: ${parentChatErr.message}` }, { status: 500 });
    }
    
    if (parentChat?.id) {
      const messageToParentB = `✅ ${nameA} has accepted the friend request! ${nameA} and ${nameB} are now connected and can chat together.`;
      const { error: msgErr2 } = await admin.from("messages").insert({
        chat_id: parentChat.id,
        sender_id: parentAId, // From Parent A (the inviting parent)
        content: messageToParentB,
      }).select("id").single();
      if (msgErr2) {
        console.error("Failed to send message to Parent B:", msgErr2);
        return NextResponse.json({ error: `Failed to send message to Parent B: ${msgErr2.message}` }, { status: 500 });
      }
    } else {
      console.warn(`Parent chat not found for ${parentAId} and ${parentBId}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unexpected error in send-acceptance-messages:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
