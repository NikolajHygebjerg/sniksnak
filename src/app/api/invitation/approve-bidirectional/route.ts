import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * POST /api/invitation/approve-bidirectional
 * Creates bidirectional approvals for both children when either parent accepts.
 * Body: { inviting_child_id: string, invited_child_id: string, accepting_parent_id: string }
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
    let acceptingParentId: string;
    try {
      const body = await request.json();
      invitingChildId = typeof body?.inviting_child_id === "string" ? body.inviting_child_id.trim() : "";
      invitedChildId = typeof body?.invited_child_id === "string" ? body.invited_child_id.trim() : "";
      acceptingParentId = typeof body?.accepting_parent_id === "string" ? body.accepting_parent_id.trim() : "";
      if (!invitingChildId || !invitedChildId || !acceptingParentId) {
        return NextResponse.json({ error: "Missing inviting_child_id, invited_child_id, or accepting_parent_id" }, { status: 400 });
      }
    } catch (err) {
      console.error("JSON parse error:", err);
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Verify caller is the accepting parent
    if (caller.id !== acceptingParentId) {
      return NextResponse.json({ error: "Unauthorized: you are not the accepting parent" }, { status: 403 });
    }

    const admin = createServiceRoleClient();

    // Get both parents
    const { data: linkInviting, error: linkInvitingErr } = await admin
      .from("parent_child_links")
      .select("parent_id")
      .eq("child_id", invitingChildId)
      .limit(1)
      .maybeSingle();
    if (linkInvitingErr || !linkInviting?.parent_id) {
      return NextResponse.json({ error: "Failed to find inviting child's parent" }, { status: 404 });
    }
    const parentAId = linkInviting.parent_id;

    const { data: linkInvited, error: linkInvitedErr } = await admin
      .from("parent_child_links")
      .select("parent_id")
      .eq("child_id", invitedChildId)
      .limit(1)
      .maybeSingle();
    if (linkInvitedErr || !linkInvited?.parent_id) {
      return NextResponse.json({ error: "Failed to find invited child's parent" }, { status: 404 });
    }
    const parentBId = linkInvited.parent_id;

    // Verify caller is one of the parents
    if (caller.id !== parentAId && caller.id !== parentBId) {
      return NextResponse.json({ error: "Unauthorized: you are not a parent in this invitation" }, { status: 403 });
    }

    // Approve both directions bidirectionally
    // Child B → Child A (using Parent B's ID)
    const { error: errB } = await admin.from("parent_approved_contacts").insert({
      child_id: invitedChildId, // Child B
      contact_user_id: invitingChildId, // Child A
      parent_id: parentBId, // Parent B
    }).select().single();
    if (errB && errB.code !== "23505") {
      // 23505 = unique constraint violation (already exists)
      console.error("Failed to approve Child B → Child A:", errB);
      return NextResponse.json({ error: `Failed to approve Child B → Child A: ${errB.message}` }, { status: 500 });
    }
    if (!errB) {
      console.log("Approved Child B → Child A");
    }

    // Child A → Child B (using Parent A's ID)
    const { error: errA } = await admin.from("parent_approved_contacts").insert({
      child_id: invitingChildId, // Child A
      contact_user_id: invitedChildId, // Child B
      parent_id: parentAId, // Parent A
    }).select().single();
    if (errA && errA.code !== "23505") {
      // 23505 = unique constraint violation (already exists)
      console.error("Failed to approve Child A → Child B:", errA);
      return NextResponse.json({ error: `Failed to approve Child A → Child B: ${errA.message}` }, { status: 500 });
    }
    if (!errA) {
      console.log("Approved Child A → Child B");
    }

    console.log(`Bidirectional approval created: Child A (${invitingChildId}) ↔ Child B (${invitedChildId})`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unexpected error in approve-bidirectional:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
