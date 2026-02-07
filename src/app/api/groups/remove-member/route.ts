import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * POST /api/groups/remove-member
 * Remove a member from a group (admin only)
 * Body: { groupId: string, userId: string }
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
  const userIdToRemove = typeof body?.userId === "string" ? body.userId.trim() : "";

  if (!groupId || !userIdToRemove) {
    return NextResponse.json({ error: "groupId and userId are required" }, { status: 400 });
  }

  // Cannot remove yourself
  if (userIdToRemove === user.id) {
    return NextResponse.json({ error: "Cannot remove yourself from the group" }, { status: 400 });
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
    return NextResponse.json({ error: "Only group admins can remove members" }, { status: 403 });
  }

  // Verify the user to remove is actually a member
  const { data: memberToRemove, error: memberErr } = await admin
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", userIdToRemove)
    .maybeSingle();

  if (memberErr || !memberToRemove) {
    return NextResponse.json({ error: "User is not a member of this group" }, { status: 404 });
  }

  // Remove the member
  const { error: deleteErr } = await admin
    .from("group_members")
    .delete()
    .eq("id", memberToRemove.id);

  if (deleteErr) {
    console.error("Error removing member:", deleteErr);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
