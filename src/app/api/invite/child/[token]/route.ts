import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { verifyInviteToken } from "@/lib/invite-token";

/**
 * GET /api/invite/child/[token]
 * Validates the invite token and returns the child's first name and email (synthetic)
 * so the client can show "Welcome {first_name}" and sign in with email + PIN.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const payload = verifyInviteToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired invitation link" }, { status: 404 });
  }

  const supabase = createServiceRoleClient();
  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, first_name, username")
    .eq("id", payload.child_id)
    .maybeSingle();

  if (error) {
    if (/first_name|surname|schema cache|column/i.test(error.message)) {
      return NextResponse.json(
        { error: "Missing columns on users. Run supabase/migrations/005_child_firstname_surname.sql in Supabase SQL Editor." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Child account not found" }, { status: 404 });
  }

  const first_name = (user as { first_name?: string }).first_name ?? (user as { username?: string }).username ?? "your child";
  return NextResponse.json({
    first_name: String(first_name).trim() || "your child",
    email: user.email,
  });
}
