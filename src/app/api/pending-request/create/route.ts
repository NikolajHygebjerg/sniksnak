import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * API endpoint to create a pending contact request
 * Uses service role to bypass RLS
 * 
 * POST /api/pending-request/create
 * Body: { child_id: string, contact_user_id: string, chat_id: string }
 */
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Server mangler SUPABASE_SERVICE_ROLE_KEY eller URL" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "").trim();
  if (!token) {
    return NextResponse.json({ error: "Uautoriseret. Send Authorization: Bearer <access_token>." }, { status: 401 });
  }

  // Verify the user is authenticated
  const anonClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
  const { data: { user: authUser }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !authUser) {
    return NextResponse.json({ error: "Ugyldig eller udløbet session" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON" }, { status: 400 });
  }

  const { child_id, contact_user_id, chat_id } = body || {};

  // Validate input
  if (!child_id || !contact_user_id || !chat_id) {
    return NextResponse.json(
      { error: "Manglende påkrævede felter: child_id, contact_user_id, chat_id" },
      { status: 400 }
    );
  }

  // Verify that contact_user_id matches the authenticated user
  if (contact_user_id !== authUser.id) {
    return NextResponse.json(
      { error: "contact_user_id skal matche den autentificerede bruger" },
      { status: 403 }
    );
  }

  // Use service role to bypass RLS
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Upsert the pending contact request
  const { data, error } = await admin
    .from("pending_contact_requests")
    .upsert(
      { child_id, contact_user_id, chat_id },
      { onConflict: "child_id,contact_user_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("Error creating pending contact request:", error);
    return NextResponse.json(
      { error: error.message, details: error },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, data });
}
