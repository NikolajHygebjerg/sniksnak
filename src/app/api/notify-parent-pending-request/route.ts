import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * POST /api/notify-parent-pending-request
 * Called when someone started a chat with a child. The pending request is already
 * stored in pending_contact_requests; the parent sees it in-app (badge + Chat requests).
 * No email is sent.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "").trim();
  if (!token || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Unauthorized or server not configured" }, { status: 401 });
  }

  const anonClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
  const { data: { user: caller }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !caller) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  let body: { child_id?: string; contact_user_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const child_id = typeof body.child_id === "string" ? body.child_id.trim() : "";
  const contact_user_id = typeof body.contact_user_id === "string" ? body.contact_user_id.trim() : "";
  if (!child_id || !contact_user_id || contact_user_id !== caller.id) {
    return NextResponse.json({ error: "Invalid or unauthorized request" }, { status: 400 });
  }

  // Parent is notified in-app via pending_contact_requests (badge + Chat requests on parent dashboard).
  return NextResponse.json({ ok: true });
}
