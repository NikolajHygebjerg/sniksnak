import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

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

    // Get all groups where user is a member OR is the creator
    // First get memberships - use service role to bypass RLS
    let memberships: any[] | null = null;
    let membershipsErr: any = null;
    
    try {
      const admin = createServiceRoleClient();
      const { data: membershipsData, error: membershipsErrData } = await admin
        .from("group_members")
        .select("group_id, role, joined_at")
        .eq("user_id", user.id);
      
      memberships = membershipsData;
      membershipsErr = membershipsErrData;
    } catch (adminErr) {
      console.error("Failed to use service role for memberships, falling back:", adminErr);
      // Fallback to regular client
      const { data: membershipsData, error: membershipsErrData } = await client
        .from("group_members")
        .select("group_id, role, joined_at")
        .eq("user_id", user.id);
      
      memberships = membershipsData;
      membershipsErr = membershipsErrData;
    }

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
      
      // Don't fail completely - just log and continue with created groups only
      console.warn("Failed to fetch memberships, continuing with created groups only");
      memberships = [];
    }

    // Get all groups where user is a member OR creator
    // Combine membership groups and created groups explicitly
    const membershipGroupIds = (memberships || []).map(m => m.group_id);
    
    // Also get groups where user is the creator (even if not a member yet)
    // Use service role to ensure we get all created groups
    let createdGroups: any[] | null = null;
    try {
      const admin = createServiceRoleClient();
      const { data: createdGroupsData, error: createdGroupsErr } = await admin
        .from("groups")
        .select("id, created_by")
        .eq("created_by", user.id);

      if (createdGroupsErr) {
        console.error("Error fetching created groups:", {
          error: createdGroupsErr,
          code: createdGroupsErr?.code,
          message: createdGroupsErr?.message,
        });
      } else {
        createdGroups = createdGroupsData;
      }
    } catch (adminErr) {
      console.error("Failed to use service role for created groups, falling back:", adminErr);
      // Fallback to regular client
      const { data: createdGroupsData, error: createdGroupsErr } = await client
        .from("groups")
        .select("id, created_by")
        .eq("created_by", user.id);

      if (createdGroupsErr) {
        console.error("Error fetching created groups:", {
          error: createdGroupsErr,
          code: createdGroupsErr?.code,
          message: createdGroupsErr?.message,
        });
      } else {
        createdGroups = createdGroupsData;
      }
    }

    // Combine membership groups and created groups
    const createdGroupIds = (createdGroups || []).map(g => g.id);
    const allGroupIdsSet = new Set([...membershipGroupIds, ...createdGroupIds]);
    const allGroupIds = Array.from(allGroupIdsSet);

    console.log("=== Group List Debug ===");
    console.log("User ID:", user.id);
    console.log("Memberships found:", memberships?.length || 0, memberships);
    console.log("Membership group IDs:", membershipGroupIds);
    console.log("Created groups found:", createdGroups?.length || 0, createdGroups);
    console.log("Created group IDs:", createdGroupIds);
    console.log("Total unique group IDs:", allGroupIds.length, allGroupIds);

    if (allGroupIds.length === 0) {
      return NextResponse.json({ groups: [] });
    }

    const groupIds = allGroupIds;

    console.log("Fetching groups for IDs:", groupIds.length, groupIds);

    // Get group details
    // Use service role client to ensure we get all groups (bypass RLS filtering)
    // We've already verified user has access (member or creator) above
    let groups: any[] | null = null;
    let groupsErr: any = null;
    
    try {
      const admin = createServiceRoleClient();
      
      // Fetch groups using service role to bypass RLS
      // We've already verified access above, so this is safe
      const { data: groupsWithAvatar, error: groupsErrWithAvatar } = await admin
        .from("groups")
        .select("id, name, created_by, created_at, avatar_url")
        .in("id", groupIds)
        .order("created_at", { ascending: false });
      
      if (groupsErrWithAvatar) {
        // If error is due to missing avatar_url column, try without it
        if (groupsErrWithAvatar?.message?.includes("avatar_url") || groupsErrWithAvatar?.code === "42703") {
          const { data: groupsWithoutAvatar, error: groupsErrWithoutAvatar } = await admin
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
    } catch (adminErr) {
      console.error("Failed to use service role client, falling back to regular client:", adminErr);
      // Fallback to regular client if service role is not available
      const { data: groupsWithAvatar, error: groupsErrWithAvatar } = await client
        .from("groups")
        .select("id, name, created_by, created_at, avatar_url")
        .in("id", groupIds)
        .order("created_at", { ascending: false });
      
      if (groupsErrWithAvatar) {
        if (groupsErrWithAvatar?.message?.includes("avatar_url") || groupsErrWithAvatar?.code === "42703") {
          const { data: groupsWithoutAvatar, error: groupsErrWithoutAvatar } = await client
            .from("groups")
            .select("id, name, created_by, created_at")
            .in("id", groupIds)
            .order("created_at", { ascending: false });
          
          groups = groupsWithoutAvatar;
          groupsErr = groupsErrWithoutAvatar;
          
          if (groups) {
            groups = groups.map(g => ({ ...g, avatar_url: null }));
          }
        } else {
          groupsErr = groupsErrWithAvatar;
        }
      } else {
        groups = groupsWithAvatar;
      }
    }

    console.log("Fetched groups:", groups?.length || 0, "Expected:", groupIds.length);
    if (groups && groups.length < groupIds.length) {
      console.warn("Some groups were filtered out! Expected:", groupIds.length, "Got:", groups.length);
      console.warn("Missing group IDs:", groupIds.filter(id => !groups?.some(g => g.id === id)));
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
    // For groups where user is creator but not member, set role to "admin" and joined_at to created_at
    const groupsWithMembership = (groups || []).map(group => {
      const membership = memberships.find(m => m.group_id === group.id);
      // If user is creator but not member, they should be admin
      const isCreator = group.created_by === user.id;
      const role = membership?.role || (isCreator ? "admin" : "member");
      const joined_at = membership?.joined_at || group.created_at;
      
      console.log("Group:", group.id, "name:", group.name, "creator:", group.created_by, "isCreator:", isCreator, "membership:", !!membership, "role:", role);
      
      return {
        ...group,
        role,
        joined_at,
      };
    });

    console.log("Returning groups:", groupsWithMembership.length, "for user:", user.id);

    return NextResponse.json({ groups: groupsWithMembership });
  } catch (err) {
    console.error("Unexpected error in /api/groups/list:", err);
    return NextResponse.json({ 
      error: "Internal server error",
      details: err instanceof Error ? err.message : "Unknown error"
    }, { status: 500 });
  }
}
