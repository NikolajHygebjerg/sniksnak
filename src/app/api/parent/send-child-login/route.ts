import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Chat App <onboarding@resend.dev>";

/** Slug for username: firstname_surname lowercase, non-empty parts only */
function toUsername(firstName: string, surname: string): string {
  const f = firstName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "first";
  const s = surname.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "surname";
  return `${f}_${s}`;
}

/**
 * POST /api/parent/send-child-login
 * Sends child login credentials (username and PIN) to parent's email.
 * Requires: Authorization header with parent's access token, and childId in body.
 */
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Server mangler SUPABASE_SERVICE_ROLE_KEY eller URL" },
      { status: 503 }
    );
  }

  if (!resendApiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY ikke sat. Email sending er ikke konfigureret." },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "").trim();
  if (!token) {
    return NextResponse.json({ error: "Uautoriseret. Send Authorization: Bearer <access_token>." }, { status: 401 });
  }

  const anonClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
  const { data: { user: parentUser }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !parentUser) {
    return NextResponse.json({ error: "Ugyldig eller udløbet session" }, { status: 401 });
  }

  let body: { childId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON body" }, { status: 400 });
  }

  const childId = typeof body.childId === "string" ? body.childId.trim() : "";
  if (!childId) {
    return NextResponse.json({ error: "childId er påkrævet" }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Verify that this parent is linked to this child
  const { data: link, error: linkErr } = await admin
    .from("parent_child_links")
    .select("child_pin, parent_id")
    .eq("parent_id", parentUser.id)
    .eq("child_id", childId)
    .maybeSingle();

  if (linkErr) {
    return NextResponse.json({ error: linkErr.message }, { status: 500 });
  }

  if (!link) {
    return NextResponse.json(
      { error: "Barn ikke fundet eller du har ikke adgang til dette barn" },
      { status: 404 }
    );
  }

  // Get child's information
  const { data: child, error: childErr } = await admin
    .from("users")
    .select("id, email, first_name, surname, username")
    .eq("id", childId)
    .maybeSingle();

  if (childErr) {
    return NextResponse.json({ error: childErr.message }, { status: 500 });
  }

  if (!child) {
    return NextResponse.json({ error: "Børnekonto ikke fundet" }, { status: 404 });
  }

  // Get parent's email
  const { data: parentUserData, error: parentErr } = await admin
    .from("users")
    .select("email")
    .eq("id", parentUser.id)
    .maybeSingle();

  if (parentErr || !parentUserData?.email) {
    return NextResponse.json({ error: "Forældres email ikke fundet" }, { status: 500 });
  }

  const parentEmail = parentUserData.email;
  const childPin = link.child_pin;

  if (!childPin) {
    return NextResponse.json(
      { error: "PIN ikke tilgængelig. Dette barn blev oprettet før PIN lagring blev implementeret." },
      { status: 400 }
    );
  }

  const firstName = child.first_name || "";
  const surname = child.surname || "";
  const username = child.username || toUsername(firstName, surname);
  const displayName = firstName && surname ? `${firstName} ${surname}` : username;

  const resend = new Resend(resendApiKey);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const loginUrl = `${appUrl}/child-login`;

  const { error: emailErr } = await resend.emails.send({
    from: fromEmail,
    to: parentEmail,
    subject: `Loginoplysninger for ${displayName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Loginoplysninger for ${escapeHtml(displayName)}</h2>
        <p>Her er loginoplysningerne for dit barn:</p>
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 10px 0;"><strong>Fornavn:</strong> ${escapeHtml(firstName)}</p>
          <p style="margin: 10px 0;"><strong>Efternavn:</strong> ${escapeHtml(surname)}</p>
          <p style="margin: 10px 0;"><strong>Brugernavn:</strong> <code style="background-color: #fff; padding: 2px 6px; border-radius: 4px;">${escapeHtml(username)}</code></p>
          <p style="margin: 10px 0;"><strong>PIN:</strong> <code style="background-color: #fff; padding: 2px 6px; border-radius: 4px;">${escapeHtml(childPin)}</code></p>
        </div>
        <p>Dit barn kan logge ind på: <a href="${loginUrl}">${loginUrl}</a></p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Hvis du ikke har anmodet om disse oplysninger, kan du ignorere denne email.
        </p>
      </div>
    `,
  });

  if (emailErr) {
    return NextResponse.json({ error: `Kunne ikke sende email: ${emailErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Loginoplysninger er sendt til din email" });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
