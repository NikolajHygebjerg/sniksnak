import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

/**
 * API for moderation/notification when a message is flagged.
 * Called after a flag is inserted (e.g. from the frontend or system).
 * Supports both user-generated flags and system-generated flags (from image/text scanning).
 * 
 * POST /api/moderation/flag
 * Body: { message_id: string, flagged_by: string, reason?: string | null }
 */
export async function POST(request: NextRequest) {
  let body: { message_id?: string; flagged_by?: string; reason?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON body" }, { status: 400 });
  }

  const { message_id, flagged_by, reason } = body;

  // Validate required fields
  if (!message_id || !flagged_by) {
    return NextResponse.json(
      { error: "Manglende påkrævede felter: message_id og flagged_by" },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();

  // Insert flag into database (if not already exists)
  // Check if flag already exists for this message from this user
  const { data: existingFlag } = await admin
    .from("flags")
    .select("id")
    .eq("message_id", message_id)
    .eq("flagged_by", flagged_by)
    .maybeSingle();

  if (!existingFlag) {
    // Insert new flag
    const { error: insertError } = await admin.from("flags").insert({
      message_id,
      flagged_by,
      reason: reason || null,
    });

    if (insertError) {
      console.error("[moderation/flag] Failed to insert flag:", insertError);
      return NextResponse.json(
        { error: "Kunne ikke oprette flag", details: insertError.message },
        { status: 500 }
      );
    }
  }

  // Log the flag
  if (process.env.NODE_ENV !== "test") {
    console.log("[moderation/flag]", {
      message_id,
      flagged_by,
      reason: reason ?? "(no reason)",
      at: new Date().toISOString(),
      isSystemFlag: flagged_by === "13afd8bf-90a6-49b9-b38e-49c8274ac157", // Sikker Chat user ID
    });
  }

  // Note: Parent notifications are handled by the scanning APIs (scan-and-flag, scan-image)
  // This endpoint is primarily for logging and ensuring flags are created

  return NextResponse.json({ ok: true, flagged: true });
}
