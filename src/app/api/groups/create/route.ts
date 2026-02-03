import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const BUCKET = "chat-media";

/**
 * POST /api/groups/create
 * Create a new group
 * Accepts multipart/form-data with name (required) and avatar (optional image file)
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "").trim();
  if (!token) {
    return NextResponse.json({ error: "Uautoriseret" }, { status: 401 });
  }

  if (!supabaseUrl) {
    return NextResponse.json({ error: "Server konfigurationsfejl" }, { status: 500 });
  }

  const client = createClient(supabaseUrl, anonKey);
  const { data: { user }, error: authErr } = await client.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Ugyldig session" }, { status: 401 });
  }

  // Verify user is a child (check both is_child flag and username)
  const admin = createServiceRoleClient();
  const { data: userData, error: userErr } = await admin
    .from("users")
    .select("username, is_child")
    .eq("id", user.id)
    .maybeSingle();

  if (userErr) {
    console.error("Error checking user:", userErr);
    return NextResponse.json({ error: "Kunne ikke verificere bruger" }, { status: 500 });
  }

  // Check if user is a child - either has is_child=true OR has a username
  const isChild = userData?.is_child === true || (userData?.username && userData.username.trim() !== "");
  
  if (!isChild) {
    console.error("User is not a child:", {
      userId: user.id,
      is_child: userData?.is_child,
      username: userData?.username,
    });
    return NextResponse.json({ error: "Kun børn kan oprette grupper" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let name = "";
  let avatarFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    name = (formData.get("name") as string | null)?.trim() ?? "";
    const avatar = formData.get("avatar");
    if (avatar instanceof File) {
      avatarFile = avatar;
    }
    // Fjern check for Blob, da Node.js ikke har Blob globalt.
    // Hvis du vil håndtere en mulig string, kan du evt. konvertere til buffer:
    // else if (typeof avatar === "string") {
    //   // Hvis du forventer en base64 string:
    //   // avatarFile = Buffer.from(avatar, "base64");
    // }
  } else {
    try {
      const body = await request.json();
      name = typeof body?.name === "string" ? body.name.trim() : "";
    } catch {
      return NextResponse.json({ error: "Ugyldig request body" }, { status: 400 });
    }
  }

  if (!name || name.length < 1) {
    return NextResponse.json({ error: "Gruppenavn er påkrævet" }, { status: 400 });
  }

  if (name.length > 50) {
    return NextResponse.json({ error: "Gruppenavn skal være 50 tegn eller mindre" }, { status: 400 });
  }

  let avatarUrl: string | null = null;

  // Upload avatar if provided
  if (avatarFile) {
    try {
      const fileExt = avatarFile.name.split(".").pop() || "jpg";
      const fileName = `group-avatars/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadErr } = await admin.storage
        .from(BUCKET)
        .upload(fileName, avatarFile, {
          contentType: avatarFile.type || "image/jpeg",
          upsert: false,
        });

      if (uploadErr) {
        console.error("Error uploading avatar:", uploadErr);
        return NextResponse.json({ error: "Kunne ikke uploade avatar" }, { status: 500 });
      }

      const { data: { publicUrl } } = admin.storage
        .from(BUCKET)
        .getPublicUrl(fileName);

      avatarUrl = publicUrl;
    } catch (err) {
      console.error("Error processing avatar:", err);
      // Continue without avatar if upload fails
    }
  }

  // Create group
  // First check if avatar_url column exists, if not, insert without it
  const insertData: { name: string; created_by: string; avatar_url?: string | null } = {
    name: name,
    created_by: user.id,
  };
  
  if (avatarUrl) {
    insertData.avatar_url = avatarUrl;
  }

  const { data: group, error: groupErr } = await admin
    .from("groups")
    .insert(insertData)
    .select("id, name, created_by, created_at")
    .maybeSingle();

  // Try to select avatar_url if it exists (may fail if column doesn't exist yet)
  let groupWithAvatar = group;
  if (group) {
    const { data: groupWithAvatarData } = await admin
      .from("groups")
      .select("id, name, created_by, created_at, avatar_url")
      .eq("id", group.id)
      .maybeSingle();
    
    if (groupWithAvatarData) {
      groupWithAvatar = groupWithAvatarData;
    }
  }

  if (groupErr || !group) {
    console.error("Error creating group:", groupErr);
    return NextResponse.json({ error: groupErr?.message || "Kunne ikke oprette gruppe" }, { status: 500 });
  }

  // Add creator as admin member
  // Use service role to bypass RLS
  const { data: memberData, error: memberErr } = await admin
    .from("group_members")
    .insert({
      group_id: group.id,
      user_id: user.id,
      role: "admin",
    })
    .select("id, role, joined_at")
    .maybeSingle();

  if (memberErr || !memberData) {
    console.error("Error adding creator as member:", {
      error: memberErr,
      code: memberErr?.code,
      message: memberErr?.message,
      details: memberErr?.details,
      hint: memberErr?.hint,
      groupId: group.id,
      userId: user.id,
    });
    
    // Check if table doesn't exist
    if (memberErr?.code === "42P01" || memberErr?.message?.includes("does not exist")) {
      await admin.from("groups").delete().eq("id", group.id);
      return NextResponse.json({ 
        error: "Grupper funktion ikke initialiseret. Kør migration 021_create_groups.sql" 
      }, { status: 500 });
    }
    
    // Try to delete the group if member insertion fails
    await admin.from("groups").delete().eq("id", group.id);
    return NextResponse.json({ 
      error: "Kunne ikke tilføje opretter til gruppe",
      details: memberErr?.message || "Ukendt fejl"
    }, { status: 500 });
  }
  
  console.log("Successfully added creator as admin member:", {
    groupId: group.id,
    userId: user.id,
    memberId: memberData.id,
  });

  // Return group with membership info
  const groupWithMembership = {
    ...(groupWithAvatar || group),
    role: memberData.role,
    joined_at: memberData.joined_at,
  };

  return NextResponse.json({ ok: true, group: groupWithMembership });
}
