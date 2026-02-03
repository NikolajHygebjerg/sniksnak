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
 * POST /api/invitation/create-parent-chat
 * Called when a child (or user) starts a chat with another child.
 * Creates a parent–parent chat and an intro message so the invited child's parent
 * gets a chat from the inviting child's parent.
 * Body: { invited_child_id: string }
 * Auth: current user = inviting user (the one who started the chat).
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !supabaseUrl) {
    return NextResponse.json({ error: "Uautoriseret" }, { status: 401 });
  }

  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: { user: caller }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !caller) {
    return NextResponse.json({ error: "Ugyldig session" }, { status: 401 });
  }

  let invitedChildId: string;
  try {
    const body = await request.json();
    invitedChildId = typeof body?.invited_child_id === "string" ? body.invited_child_id.trim() : "";
    if (!invitedChildId) {
      return NextResponse.json({ error: "Manglende invited_child_id" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON body" }, { status: 400 });
  }

  const invitingUserId = caller.id;
  if (invitingUserId === invitedChildId) {
    return NextResponse.json({ error: "Kan ikke invitere sig selv" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Find Parent A (inviting child's parent)
  const { data: linkA, error: linkAErr } = await admin
    .from("parent_child_links")
    .select("parent_id")
    .eq("child_id", invitingUserId)
    .limit(1)
    .maybeSingle();
  
  if (linkAErr) {
    console.error("Error finding Parent A:", linkAErr);
    return NextResponse.json({ ok: false, error: "Fejl ved søgning efter inviterende barns forælder" }, { status: 500 });
  }
  
  const parentAId = linkA?.parent_id;
  if (!parentAId) {
    console.log(`⚠️ Inviting user ${invitingUserId} has no linked parent - parent chat not created`);
    return NextResponse.json({ ok: false, message: "Inviterende bruger har ingen tilknyttet forælder; forældre chat ikke oprettet." });
  }

  // Find Parent B (invited child's parent)
  const { data: linkB, error: linkBErr } = await admin
    .from("parent_child_links")
    .select("parent_id")
    .eq("child_id", invitedChildId)
    .limit(1)
    .maybeSingle();
  
  if (linkBErr) {
    console.error("Error finding Parent B:", linkBErr);
    return NextResponse.json({ ok: false, error: "Fejl ved søgning efter inviteret barns forælder" }, { status: 500 });
  }
  
  const parentBId = linkB?.parent_id;
  if (!parentBId) {
    console.log(`⚠️ Invited child ${invitedChildId} has no linked parent - parent chat not created`);
    return NextResponse.json({ ok: false, message: "Inviteret barn har ingen tilknyttet forælder; forældre chat ikke oprettet." });
  }
  
  console.log(`✅ Found parents: Parent A (${parentAId}) for child ${invitingUserId}, Parent B (${parentBId}) for child ${invitedChildId}`);

  if (parentAId === parentBId) {
    console.log(`ℹ️ Both children have the same parent (${parentAId}). Creating a self-chat for the parent to manage the request.`);
    // Even when both children have the same parent, create a chat so the parent can see and manage the request
    // Use the parent ID for both user1_id and user2_id (self-chat)
    const { data: existingSelfChat, error: existingSelfChatErr } = await admin
      .from("chats")
      .select("id")
      .eq("user1_id", parentAId)
      .eq("user2_id", parentAId)
      .maybeSingle();
    
    if (existingSelfChatErr) {
      console.error("Error checking for existing self-chat:", existingSelfChatErr);
    }
    
    let parentChatId: string;
    if (existingSelfChat?.id) {
      parentChatId = existingSelfChat.id;
      console.log(`✅ Using existing self-chat: ${parentChatId}`);
    } else {
      const { data: newSelfChat, error: insertSelfChatErr } = await admin
        .from("chats")
        .insert({ user1_id: parentAId, user2_id: parentAId })
        .select("id")
        .maybeSingle();
      
      if (insertSelfChatErr) {
        console.error("Error creating self-chat:", insertSelfChatErr);
        return NextResponse.json({ error: insertSelfChatErr.message ?? "Kunne ikke oprette forældre chat" }, { status: 500 });
      }
      
      if (!newSelfChat?.id) {
        console.error("Self-chat creation returned no ID");
        return NextResponse.json({ error: "Kunne ikke oprette forældre chat - ingen ID returneret" }, { status: 500 });
      }
      
      parentChatId = newSelfChat.id;
      console.log(`✅ Created new self-chat: ${parentChatId}`);
    }
    
    // Create invitation record
    const { data: existingInvitation } = await admin
      .from("parent_invitation_chats")
      .select("id, chat_id")
      .eq("inviting_child_id", invitingUserId)
      .eq("invited_child_id", invitedChildId)
      .maybeSingle();
    
    if (existingInvitation?.chat_id) {
      return NextResponse.json({ ok: true, chat_id: existingInvitation.chat_id, already_exists: true, same_parent: true });
    }
    
    const { data: childA, error: childAErr } = await admin.from("users").select("id, email, username, first_name, surname").eq("id", invitingUserId).maybeSingle();
    const { data: childB, error: childBErr } = await admin.from("users").select("id, email, username, first_name, surname").eq("id", invitedChildId).maybeSingle();
    
    if (childAErr || !childA) {
      console.error("Error fetching inviting child:", childAErr);
      return NextResponse.json({ error: "Inviterende barn ikke fundet" }, { status: 404 });
    }
    
    if (childBErr || !childB) {
      console.error("Error fetching invited child:", childBErr);
      return NextResponse.json({ error: "Inviteret barn ikke fundet" }, { status: 404 });
    }
    
    const nameA = displayName(childA);
    const nameB = displayName(childB);
    const introContent = `Hej! Dit barn ${nameA} vil gerne oprette forbindelse med mit barn ${nameB}. Du er velkommen til at chatte med mig her. Acceptér/afvis`;
    
    const { error: insertInvitationErr } = await admin
      .from("parent_invitation_chats")
      .insert({
        chat_id: parentChatId,
        inviting_child_id: invitingUserId,
        invited_child_id: invitedChildId,
        status: "pending",
      });
    if (insertInvitationErr) {
      return NextResponse.json({ error: insertInvitationErr.message }, { status: 500 });
    }
    
    // Check if intro message already exists
    const { data: existingMessage } = await admin
      .from("messages")
      .select("id")
      .eq("chat_id", parentChatId)
      .eq("content", introContent)
      .limit(1)
      .maybeSingle();
    
    if (!existingMessage) {
      // Send intro message from the parent to themselves
      const { error: msgErr } = await admin
        .from("messages")
        .insert({
          chat_id: parentChatId,
          sender_id: parentAId,
          content: introContent,
        });
      if (msgErr) {
        console.error("Error sending intro message:", msgErr);
        return NextResponse.json({ error: msgErr.message }, { status: 500 });
      }
      
      console.log(`✅ Self-chat invitation created: Parent (${parentAId}), chat: ${parentChatId}`);
    } else {
      console.log(`ℹ️ Intro message already exists for this self-chat: ${parentChatId}`);
    }
    
    return NextResponse.json({ ok: true, chat_id: parentChatId, same_parent: true });
  }

  const [u1, u2] = [parentAId, parentBId].sort();
  
  // Find or create parent-to-parent chat
  const { data: existingChat, error: existingChatErr } = await admin
    .from("chats")
    .select("id")
    .eq("user1_id", u1)
    .eq("user2_id", u2)
    .maybeSingle();

  if (existingChatErr) {
    console.error("Error checking for existing parent chat:", existingChatErr);
    return NextResponse.json({ error: "Fejl ved tjek for eksisterende chat" }, { status: 500 });
  }

  let parentChatId: string;
  if (existingChat?.id) {
    parentChatId = existingChat.id;
    console.log(`✅ Using existing parent chat: ${parentChatId}`);
  } else {
    const { data: newChat, error: insertChatErr } = await admin
      .from("chats")
      .insert({ user1_id: u1, user2_id: u2 })
      .select("id")
      .maybeSingle();
    
    if (insertChatErr) {
      console.error("Error creating parent chat:", insertChatErr);
      return NextResponse.json({ error: insertChatErr.message ?? "Kunne ikke oprette forældre chat" }, { status: 500 });
    }
    
    if (!newChat?.id) {
      console.error("Parent chat creation returned no ID");
      return NextResponse.json({ error: "Kunne ikke oprette forældre chat - ingen ID returneret" }, { status: 500 });
    }
    
    parentChatId = newChat.id;
    console.log(`✅ Created new parent chat: ${parentChatId}`);
  }

  const { data: existingInvitation } = await admin
    .from("parent_invitation_chats")
    .select("id, chat_id")
    .eq("inviting_child_id", invitingUserId)
    .eq("invited_child_id", invitedChildId)
    .maybeSingle();

  if (existingInvitation?.chat_id) {
    return NextResponse.json({ ok: true, chat_id: existingInvitation.chat_id, already_exists: true });
  }

  const { data: childA, error: childAErr } = await admin.from("users").select("id, email, username, first_name, surname").eq("id", invitingUserId).maybeSingle();
  const { data: childB, error: childBErr } = await admin.from("users").select("id, email, username, first_name, surname").eq("id", invitedChildId).maybeSingle();
  
    if (childAErr || !childA) {
      console.error("Error fetching inviting child:", childAErr);
      return NextResponse.json({ error: "Inviterende barn ikke fundet" }, { status: 404 });
    }
    
    if (childBErr || !childB) {
      console.error("Error fetching invited child:", childBErr);
      return NextResponse.json({ error: "Inviteret barn ikke fundet" }, { status: 404 });
    }
  const nameA = displayName(childA);
  const nameB = displayName(childB);

  // Intro message format: "Hej! Dit barn [nameA] vil gerne oprette forbindelse med mit barn [nameB]. Du er velkommen til at chatte med mig her. Acceptér/afvis"
  const introContent = `Hej! Dit barn ${nameA} vil gerne oprette forbindelse med mit barn ${nameB}. Du er velkommen til at chatte med mig her. Acceptér/afvis`;

  const { error: insertInvitationErr } = await admin
    .from("parent_invitation_chats")
    .insert({
      chat_id: parentChatId,
      inviting_child_id: invitingUserId,
      invited_child_id: invitedChildId,
      status: "pending",
    });
  if (insertInvitationErr) {
    return NextResponse.json({ error: insertInvitationErr.message }, { status: 500 });
  }

  // Check if intro message already exists (avoid duplicates)
  const { data: existingMessage } = await admin
    .from("messages")
    .select("id")
    .eq("chat_id", parentChatId)
    .eq("content", introContent)
    .limit(1)
    .maybeSingle();
  
  if (!existingMessage) {
    // Send intro message FROM Parent A (inviting parent) TO Parent B (invited child's parent)
    // Parent B will see this message and can accept/reject the friend request
    const { error: msgErr } = await admin
      .from("messages")
      .insert({
        chat_id: parentChatId,
        sender_id: parentAId,
        content: introContent,
      });
    if (msgErr) {
      console.error("Error sending intro message:", msgErr);
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }
    
    console.log(`✅ Parent chat invitation created: Parent A (${parentAId}) -> Parent B (${parentBId}), chat: ${parentChatId}`);
  } else {
    console.log(`ℹ️ Intro message already exists for this parent chat: ${parentChatId}`);
  }

  return NextResponse.json({ ok: true, chat_id: parentChatId });
}
