import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * POST /api/groups/accept-invitation
 * Accept a group invitation
 * Body: { invitationId: string }
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

  const invitationId = typeof body?.invitationId === "string" ? body.invitationId.trim() : "";
  if (!invitationId) {
    return NextResponse.json({ error: "invitationId is required" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Get invitation
  const { data: invitation, error: inviteErr } = await admin
    .from("group_invitations")
    .select("id, group_id, invited_user_id, status")
    .eq("id", invitationId)
    .maybeSingle();

  if (inviteErr || !invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  if (invitation.invited_user_id !== user.id) {
    return NextResponse.json({ error: "This invitation is not for you" }, { status: 403 });
  }

  if (invitation.status !== "pending") {
    return NextResponse.json({ error: "Invitation already processed" }, { status: 400 });
  }

  // Check if user is already a member
  const { data: existingMember } = await admin
    .from("group_members")
    .select("id")
    .eq("group_id", invitation.group_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMember) {
    // Already a member, just update invitation status
    await admin
      .from("group_invitations")
      .update({ status: "accepted" })
      .eq("id", invitationId);
    return NextResponse.json({ ok: true, message: "Already a member" });
  }

  // Add user as member
  const { error: memberErr } = await admin
    .from("group_members")
    .insert({
      group_id: invitation.group_id,
      user_id: user.id,
      role: "member",
    });

  if (memberErr) {
    console.error("Error adding member:", memberErr);
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }

  // Update invitation status
  const { error: updateErr } = await admin
    .from("group_invitations")
    .update({ status: "accepted" })
    .eq("id", invitationId);

  if (updateErr) {
    console.error("Error updating invitation:", updateErr);
    // Member was added, so continue
  }

  return NextResponse.json({ ok: true, groupId: invitation.group_id });
}
