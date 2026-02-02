import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * POST /api/groups/invite
 * Invite a friend to a group
 * Body: { groupId: string, friendId: string }
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
  const friendId = typeof body?.friendId === "string" ? body.friendId.trim() : "";

  if (!groupId || !friendId) {
    return NextResponse.json({ error: "groupId and friendId are required" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Verify user is admin of the group
  const { data: membership, error: membershipErr } = await admin
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipErr || !membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Only group admins can invite members" }, { status: 403 });
  }

  // Verify friend is a child and is approved contact
  const { data: friendData, error: friendErr } = await admin
    .from("users")
    .select("id, username")
    .eq("id", friendId)
    .maybeSingle();

  if (friendErr || !friendData || !friendData.username || friendData.username.trim() === "") {
    return NextResponse.json({ error: "Friend not found or is not a child" }, { status: 404 });
  }

  // Check if friend is already a member
  const { data: existingMember } = await admin
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", friendId)
    .maybeSingle();

  if (existingMember) {
    return NextResponse.json({ error: "User is already a member of this group" }, { status: 400 });
  }

  // Check if there's already a pending invitation
  const { data: existingInvitation } = await admin
    .from("group_invitations")
    .select("id")
    .eq("group_id", groupId)
    .eq("invited_user_id", friendId)
    .eq("status", "pending")
    .maybeSingle();

  if (existingInvitation) {
    return NextResponse.json({ error: "Invitation already sent" }, { status: 400 });
  }

  // Create invitation
  const { data: invitation, error: inviteErr } = await admin
    .from("group_invitations")
    .insert({
      group_id: groupId,
      invited_by: user.id,
      invited_user_id: friendId,
      status: "pending",
    })
    .select("id, group_id, invited_user_id, status")
    .maybeSingle();

  if (inviteErr || !invitation) {
    console.error("Error creating invitation:", inviteErr);
    return NextResponse.json({ error: inviteErr?.message || "Failed to create invitation" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, invitation });
}
