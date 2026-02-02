import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

/**
 * POST /api/auth/child-email
 * Returns the synthetic email for a child account so the client can call signInWithPassword(email, pin).
 * Only returns email for users that are linked as a child (in parent_child_links).
 */
export async function POST(request: NextRequest) {
  let body: { username?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: user, error } = await supabase
    .from("users")
    .select("id, email")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    if (/username|schema cache|column/i.test(error.message)) {
      return NextResponse.json(
        { error: "The 'username' column is missing. Run supabase/migrations/004_child_username.sql in Supabase SQL Editor." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "No account with that username" }, { status: 404 });
  }

  const { data: link } = await supabase
    .from("parent_child_links")
    .select("child_id")
    .eq("child_id", user.id)
    .maybeSingle();

  if (!link) {
    return NextResponse.json({ error: "No account with that username" }, { status: 404 });
  }

  return NextResponse.json({ email: user.email });
}
