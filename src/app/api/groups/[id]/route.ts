import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * GET /api/groups/[id]
 * Get a specific group by ID (if user is a member)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "").trim();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!supabaseUrl) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const client = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: authErr } = await client.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    // Handle both sync and async params (Next.js 13+)
    const resolvedParams = params instanceof Promise ? await params : params;
    const groupId = resolvedParams.id;

    if (!groupId) {
      return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
    }

    // Verify user is a member of the group
    // Use service role to bypass RLS for this check
    let admin;
    try {
      admin = createServiceRoleClient();
    } catch (adminErr) {
      console.error("Failed to create service role client:", adminErr);
      return NextResponse.json({ 
        error: "Server configuration error",
        details: adminErr instanceof Error ? adminErr.message : "Unknown error"
      }, { status: 500 });
    }

    const { data: membership, error: membershipErr } = await admin
      .from("group_members")
      .select("role, joined_at")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipErr) {
      console.error("Error checking membership:", {
        error: membershipErr,
        code: membershipErr?.code,
        message: membershipErr?.message,
        details: membershipErr?.details,
        hint: membershipErr?.hint,
        groupId,
        userId: user.id,
      });
      
      // Check if table doesn't exist
      if (membershipErr?.code === "42P01" || membershipErr?.message?.includes("does not exist")) {
        return NextResponse.json({ 
          error: "Groups feature not initialized. Please run migration 021_create_groups.sql" 
        }, { status: 500 });
      }
      
      return NextResponse.json({ 
        error: "Failed to check membership",
        details: membershipErr?.message || "Unknown error"
      }, { status: 500 });
    }

    if (!membership) {
      return NextResponse.json({ error: "You are not a member of this group" }, { status: 403 });
    }

    // Get group details (already have admin client)
    // Try with avatar_url first, fallback if column doesn't exist
    let group: any = null;
    let groupErr: any = null;
    
    const { data: groupWithAvatar, error: groupErrWithAvatar } = await admin
      .from("groups")
      .select("id, name, created_by, created_at, avatar_url")
      .eq("id", groupId)
      .maybeSingle();
    
    if (groupErrWithAvatar) {
      // If error is due to missing avatar_url column, try without it
      if (groupErrWithAvatar?.message?.includes("avatar_url") || groupErrWithAvatar?.code === "42703") {
        const { data: groupWithoutAvatar, error: groupErrWithoutAvatar } = await admin
          .from("groups")
          .select("id, name, created_by, created_at")
          .eq("id", groupId)
          .maybeSingle();
        
        group = groupWithoutAvatar;
        groupErr = groupErrWithoutAvatar;
        
        if (group) {
          group = { ...group, avatar_url: null };
        }
      } else {
        groupErr = groupErrWithAvatar;
      }
    } else {
      group = groupWithAvatar;
    }

    if (groupErr) {
      console.error("Error fetching group:", {
        error: groupErr,
        code: groupErr?.code,
        message: groupErr?.message,
        groupId,
      });
      
      if (groupErr?.code === "42P01" || groupErr?.message?.includes("does not exist")) {
        return NextResponse.json({ 
          error: "Groups feature not initialized. Please run migration 021_create_groups.sql" 
        }, { status: 500 });
      }
      
      return NextResponse.json({ 
        error: "Group not found",
        details: groupErr?.message || "Unknown error"
      }, { status: 404 });
    }

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    return NextResponse.json({
      group: {
        ...group,
        role: membership.role,
        joined_at: membership.joined_at,
      },
    });
  } catch (err) {
    console.error("Unexpected error in /api/groups/[id]:", err);
    return NextResponse.json({
      error: "Internal server error",
      details: err instanceof Error ? err.message : "Unknown error",
    }, { status: 500 });
  }
}
