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
 * POST /api/child/request-login
 * Child requests login credentials to be sent to their parent's email.
 * Requires: firstName and surname in body.
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

  let body: { firstName?: string; surname?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON body" }, { status: 400 });
  }

  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const surname = typeof body.surname === "string" ? body.surname.trim() : "";

  if (!firstName || !surname) {
    return NextResponse.json({ error: "Fornavn og efternavn er påkrævet" }, { status: 400 });
  }

  if (firstName.length < 2 || surname.length < 2) {
    return NextResponse.json({ error: "Fornavn og efternavn skal være mindst 2 tegn" }, { status: 400 });
  }

  const username = toUsername(firstName, surname);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Find child by username
  const { data: child, error: childErr } = await admin
    .from("users")
    .select("id, email, first_name, surname, username")
    .eq("username", username)
    .maybeSingle();

  if (childErr) {
    return NextResponse.json({ error: childErr.message }, { status: 500 });
  }

  if (!child) {
    return NextResponse.json(
      { error: "Ingen konto fundet med dette navn. En forælder skal oprette en konto først." },
      { status: 404 }
    );
  }

  // Verify child is linked to a parent
  const { data: link, error: linkErr } = await admin
    .from("parent_child_links")
    .select("parent_id, child_pin")
    .eq("child_id", child.id)
    .maybeSingle();

  if (linkErr) {
    return NextResponse.json({ error: linkErr.message }, { status: 500 });
  }

  if (!link) {
    return NextResponse.json(
      { error: "Ingen forælder fundet. Kontakt en forælder for at oprette din konto." },
      { status: 404 }
    );
  }

  if (!link.child_pin) {
    return NextResponse.json(
      { error: "PIN ikke tilgængelig. Kontakt din forælder." },
      { status: 400 }
    );
  }

  // Get parent's email
  const { data: parent, error: parentErr } = await admin
    .from("users")
    .select("email, first_name, surname")
    .eq("id", link.parent_id)
    .maybeSingle();

  if (parentErr || !parent?.email) {
    return NextResponse.json({ error: "Kunne ikke finde forældrens email" }, { status: 500 });
  }

  const childFirstName = child.first_name || firstName;
  const childSurname = child.surname || surname;
  const displayName = `${childFirstName} ${childSurname}`;
  const childUsername = child.username || username;
  const childPin = link.child_pin;

  const resend = new Resend(resendApiKey);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const loginUrl = `${appUrl}/child-login`;

  const { error: emailErr } = await resend.emails.send({
    from: fromEmail,
    to: parent.email,
    subject: `Anmodning om loginoplysninger for ${displayName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Anmodning om loginoplysninger</h2>
        <p>Dit barn <strong>${escapeHtml(displayName)}</strong> har anmodet om at få deres loginoplysninger.</p>
        <p>Her er loginoplysningerne:</p>
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 10px 0;"><strong>Fornavn:</strong> ${escapeHtml(childFirstName)}</p>
          <p style="margin: 10px 0;"><strong>Efternavn:</strong> ${escapeHtml(childSurname)}</p>
          <p style="margin: 10px 0;"><strong>Brugernavn:</strong> <code style="background-color: #fff; padding: 2px 6px; border-radius: 4px;">${escapeHtml(childUsername)}</code></p>
          <p style="margin: 10px 0;"><strong>PIN:</strong> <code style="background-color: #fff; padding: 2px 6px; border-radius: 4px;">${escapeHtml(childPin)}</code></p>
        </div>
        <p>Dit barn kan logge ind på: <a href="${loginUrl}">${loginUrl}</a></p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Del disse oplysninger med dit barn så de kan logge ind.
        </p>
      </div>
    `,
  });

  if (emailErr) {
    return NextResponse.json({ error: `Kunne ikke sende email: ${emailErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Loginoplysninger er sendt til din forældres email" });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
