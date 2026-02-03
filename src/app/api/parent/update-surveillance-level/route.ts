import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * POST /api/parent/update-surveillance-level
 * Updates the surveillance level for a parent-child link
 */
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: "Server konfigurationsfejl" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "").trim();
  if (!token) {
    return NextResponse.json({ error: "Uautoriseret" }, { status: 401 });
  }

  // Create authenticated Supabase client with the user's access token for RLS
  const supabase = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Ugyldig eller udløbet session" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { childId, surveillanceLevel } = body;

    console.log("Update surveillance level request:", { parentId: user.id, childId, surveillanceLevel });

    if (!childId || typeof childId !== "string") {
      return NextResponse.json({ error: "childId er påkrævet" }, { status: 400 });
    }

    if (!surveillanceLevel || !["strict", "medium", "mild"].includes(surveillanceLevel)) {
      return NextResponse.json({ error: "surveillanceLevel skal være 'strict', 'medium' eller 'mild'" }, { status: 400 });
    }

    // Verify the parent owns this child link
    const { data: link, error: linkErr } = await supabase
      .from("parent_child_links")
      .select("id, parent_id")
      .eq("parent_id", user.id)
      .eq("child_id", childId)
      .maybeSingle();

    if (linkErr) {
      console.error("Error querying parent_child_links:", linkErr);
      return NextResponse.json({ 
        error: "Fejl ved tjek af barn link", 
        details: linkErr.message 
      }, { status: 500 });
    }

    if (!link) {
      console.error("Child link not found:", { parentId: user.id, childId });
      // Try to get all links for this parent to debug
      const { data: allLinks } = await supabase
        .from("parent_child_links")
        .select("id, parent_id, child_id")
        .eq("parent_id", user.id);
      console.log("All parent links for debugging:", allLinks);
      return NextResponse.json({ 
        error: "Barn link ikke fundet eller adgang nægtet",
        details: `Ingen forælder-barn link fundet. Forælder ID: ${user.id}, Barn ID: ${childId}`
      }, { status: 403 });
    }

    // Update surveillance level
    const { error: updateErr } = await supabase
      .from("parent_child_links")
      .update({ surveillance_level: surveillanceLevel })
      .eq("id", link.id);

    if (updateErr) {
      console.error("Error updating surveillance level:", updateErr);
      return NextResponse.json({ 
        error: updateErr.message,
        details: "Kunne ikke opdatere overvågningsniveau i databasen"
      }, { status: 500 });
    }

    console.log("Successfully updated surveillance level:", { linkId: link.id, surveillanceLevel });
    return NextResponse.json({ ok: true, surveillance_level: surveillanceLevel });
  } catch (error: any) {
    console.error("Error in update-surveillance-level:", error);
    return NextResponse.json({ error: error.message || "Intern serverfejl" }, { status: 500 });
  }
}
