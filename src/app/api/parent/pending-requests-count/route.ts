import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * GET /api/parent/pending-requests-count
 * Returns the number of pending contact requests for the authenticated parent (for badge).
 */
export async function GET(request: NextRequest) {
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

  const { data: links } = await client
    .from("parent_child_links")
    .select("child_id")
    .eq("parent_id", user.id);

  const childIds = (links ?? []).map((l: { child_id: string }) => l.child_id);
  if (childIds.length === 0) {
    return NextResponse.json({ count: 0 });
  }

  const { count, error } = await client
    .from("pending_contact_requests")
    .select("id", { count: "exact", head: true })
    .in("child_id", childIds);

  if (error) {
    return NextResponse.json({ count: 0 });
  }
  return NextResponse.json({ count: count ?? 0 });
}
