import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * GET /api/groups/list
 * Get all groups the authenticated user is a member of
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "").trim();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!supabaseUrl) {
      console.error("Missing NEXT_PUBLIC_SUPABASE_URL");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const client = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: authErr } = await client.auth.getUser(token);
    if (authErr || !user) {
      console.error("Auth error:", authErr);
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    // Get all groups where user is a member
    const { data: memberships, error: membershipsErr } = await client
      .from("group_members")
      .select("group_id, role, joined_at")
      .eq("user_id", user.id);

    if (membershipsErr) {
      console.error("Error fetching group memberships:", {
        error: membershipsErr,
        code: membershipsErr?.code,
        message: membershipsErr?.message,
        details: membershipsErr?.details,
        hint: membershipsErr?.hint,
      });
      
      // Check if table doesn't exist (migration not run)
      if (membershipsErr?.code === "42P01" || membershipsErr?.message?.includes("does not exist")) {
        return NextResponse.json({ 
          error: "Groups feature not initialized. Please run migration 021_create_groups.sql" 
        }, { status: 500 });
      }
      
      return NextResponse.json({ 
        error: "Failed to fetch groups",
        details: membershipsErr?.message || "Unknown error"
      }, { status: 500 });
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ groups: [] });
    }

    const groupIds = memberships.map(m => m.group_id);

    // Get group details
    // Try to select with avatar_url, but handle if column doesn't exist
    let groups: any[] | null = null;
    let groupsErr: any = null;
    
    const { data: groupsWithAvatar, error: groupsErrWithAvatar } = await client
      .from("groups")
      .select("id, name, created_by, created_at, avatar_url")
      .in("id", groupIds)
      .order("created_at", { ascending: false });
    
    if (groupsErrWithAvatar) {
      // If error is due to missing avatar_url column, try without it
      if (groupsErrWithAvatar?.message?.includes("avatar_url") || groupsErrWithAvatar?.code === "42703") {
        const { data: groupsWithoutAvatar, error: groupsErrWithoutAvatar } = await client
          .from("groups")
          .select("id, name, created_by, created_at")
          .in("id", groupIds)
          .order("created_at", { ascending: false });
        
        groups = groupsWithoutAvatar;
        groupsErr = groupsErrWithoutAvatar;
        
        // Add null avatar_url to each group
        if (groups) {
          groups = groups.map(g => ({ ...g, avatar_url: null }));
        }
      } else {
        groupsErr = groupsErrWithAvatar;
      }
    } else {
      groups = groupsWithAvatar;
    }

    if (groupsErr) {
      console.error("Error fetching groups:", {
        error: groupsErr,
        code: groupsErr?.code,
        message: groupsErr?.message,
        details: groupsErr?.details,
        hint: groupsErr?.hint,
      });
      
      // Check if table doesn't exist (migration not run)
      if (groupsErr?.code === "42P01" || groupsErr?.message?.includes("does not exist")) {
        return NextResponse.json({ 
          error: "Groups feature not initialized. Please run migration 021_create_groups.sql" 
        }, { status: 500 });
      }
      
      return NextResponse.json({ 
        error: "Failed to fetch group details",
        details: groupsErr?.message || "Unknown error"
      }, { status: 500 });
    }

    // Ensure groups is not null
    if (!groups) {
      groups = [];
    }

    // Combine with membership info
    const groupsWithMembership = (groups || []).map(group => {
      const membership = memberships.find(m => m.group_id === group.id);
      return {
        ...group,
        role: membership?.role || "member",
        joined_at: membership?.joined_at || group.created_at,
      };
    });

    return NextResponse.json({ groups: groupsWithMembership });
  } catch (err) {
    console.error("Unexpected error in /api/groups/list:", err);
    return NextResponse.json({ 
      error: "Internal server error",
      details: err instanceof Error ? err.message : "Unknown error"
    }, { status: 500 });
  }
}
