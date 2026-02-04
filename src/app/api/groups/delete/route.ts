import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * DELETE /api/groups/delete
 * Delete a group (only creator can delete)
 * Body: { groupId: string }
 */
export async function DELETE(request: NextRequest) {
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

  // Verify user is the creator of the group
  const { data: groupData, error: groupErr } = await admin
    .from("groups")
    .select("id, created_by")
    .eq("id", groupId)
    .maybeSingle();

  if (groupErr || !groupData) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  if (groupData.created_by !== user.id) {
    return NextResponse.json({ error: "Only the group creator can delete the group" }, { status: 403 });
  }

  // Delete the group (CASCADE will automatically delete members, invitations, chats, etc.)
  const { error: deleteErr } = await admin
    .from("groups")
    .delete()
    .eq("id", groupId);

  if (deleteErr) {
    console.error("Error deleting group:", deleteErr);
    return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
