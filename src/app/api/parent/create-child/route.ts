import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signInviteToken } from "@/lib/invite-token";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Slug for username: firstname_surname lowercase, non-empty parts only */
function toUsername(firstName: string, surname: string): string {
  const f = firstName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "first";
  const s = surname.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "surname";
  return `${f}_${s}`;
}

/** Display name: First Surname (capitalised) */
function toDisplayName(firstName: string, surname: string): string {
  const f = firstName.trim() || "First";
  const s = surname.trim() || "Surname";
  const cap = (x: string) => x.slice(0, 1).toUpperCase() + x.slice(1).toLowerCase();
  return `${cap(f)} ${cap(s)}`;
}

/** Suggest alternatives when name is taken: keep real name, add city / number / nickname (for security we insist on real name). */
function suggestAlternatives(firstName: string, surname: string): { first_name: string; surname: string; displayName: string; hint: string }[] {
  const f = firstName.trim();
  const s = surname.trim();
  const cap = (x: string) => x.slice(0, 1).toUpperCase() + x.slice(1).toLowerCase();
  const cappedS = cap(s);
  return [
    { first_name: cap(f), surname: `${cappedS} City`, displayName: `${cap(f)} ${cappedS} City`, hint: "city" },
    { first_name: cap(f), surname: `${cappedS} 2`, displayName: `${cap(f)} ${cappedS} 2`, hint: "number" },
    { first_name: cap(f), surname: `${cappedS} AJ`, displayName: `${cap(f)} ${cappedS} AJ`, hint: "nickname" },
  ];
}

const CHILD_PHOTOS_BUCKET = "chat-media";
const CHILD_PHOTOS_PREFIX = "child-photos";

/** Ensure the storage bucket exists (create if missing). Service role can create buckets. */
async function ensureBucketExists(admin: ReturnType<typeof createClient>) {
  const { data: buckets } = await admin.storage.listBuckets();
  if (buckets?.some((b) => (b as { name?: string; id?: string }).name === CHILD_PHOTOS_BUCKET || (b as { name?: string; id?: string }).id === CHILD_PHOTOS_BUCKET)) return;
  const { error } = await admin.storage.createBucket(CHILD_PHOTOS_BUCKET, { public: true });
  // Ignore "already exists" or duplicate; other errors will surface on upload
  if (error && !/already exists|duplicate|Bucket already/i.test(error.message)) {
    console.warn("create-child: could not create bucket", error.message);
  }
}

/**
 * POST /api/parent/create-child
 * Parent creates a child account: first name + surname + PIN + photo of the child (required).
 * Accepts multipart/form-data with first_name, surname, pin, and photo (image file).
 * Returns invitation_link so parent can share with child for easy setup.
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

  const anonClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
  const { data: { user: parentUser }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !parentUser) {
    return NextResponse.json({ error: "Ugyldig eller udløbet session" }, { status: 401 });
  }

  let first_name = "";
  let surname = "";
  let pin = "";
  let surveillance_level = "medium"; // Default to medium
  let photoFile: File | null = null;
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    first_name = (formData.get("first_name") as string | null)?.trim() ?? "";
    surname = (formData.get("surname") as string | null)?.trim() ?? "";
    pin = (formData.get("pin") as string | null)?.trim() ?? "";
    const levelInput = (formData.get("surveillance_level") as string | null)?.trim() ?? "";
    if (levelInput && ["strict", "medium", "mild"].includes(levelInput)) {
      surveillance_level = levelInput;
    }
    const photo = formData.get("photo");
    if (photo instanceof File) {
      photoFile = photo;
    }
  } else {
    try {
      const body = await request.json() as { first_name?: string; surname?: string; pin?: string; surveillance_level?: string };
      first_name = typeof body.first_name === "string" ? body.first_name.trim() : "";
      surname = typeof body.surname === "string" ? body.surname.trim() : "";
      pin = typeof body.pin === "string" ? body.pin.trim() : "";
      const levelInput = typeof body.surveillance_level === "string" ? body.surveillance_level.trim() : "";
      if (levelInput && ["strict", "medium", "mild"].includes(levelInput)) {
        surveillance_level = levelInput;
      }
    } catch {
      return NextResponse.json(
        { error: "Send multipart/form-data med first_name, surname, pin, surveillance_level og photo (et foto af barnet er påkrævet)." },
        { status: 400 }
      );
    }
  }

  if (!photoFile || photoFile.size === 0) {
    return NextResponse.json(
      { error: "Et foto af barnet er påkrævet. Upload venligst et klart foto af dit barn af sikkerhedsmæssige årsager." },
      { status: 400 }
    );
  }
  const isImage = photoFile.type?.startsWith?.("image/");
  if (!isImage) {
    return NextResponse.json(
      { error: "Fotoet skal være en billedfil (f.eks. JPEG eller PNG) af dit barn." },
      { status: 400 }
    );
  }

  if (!first_name || !surname) {
    return NextResponse.json({ error: "Både fornavn og efternavn er påkrævet" }, { status: 400 });
  }
  if (first_name.length < 2) {
    return NextResponse.json({ error: "Fornavn skal være mindst 2 tegn" }, { status: 400 });
  }
  if (surname.length < 2) {
    return NextResponse.json({ error: "Efternavn skal være mindst 2 tegn" }, { status: 400 });
  }
  const anonymousFirst = ["incognito", "anonymous", "anon", "unknown", "hidden", "secret", "fake", "test", "demo"];
  if (anonymousFirst.includes(first_name.toLowerCase()) || anonymousFirst.includes(surname.toLowerCase())) {
    return NextResponse.json({ error: "Brug dit barns rigtige fornavn og efternavn" }, { status: 400 });
  }
  if (!pin || pin.length < 4 || pin.length > 12) {
    return NextResponse.json({ error: "PIN skal være 4–12 tegn" }, { status: 400 });
  }

  const username = toUsername(first_name, surname);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Check if username already exists
  const { data: existing, error: existingErr } = await admin
    .from("users")
    .select("id, username, first_name, surname")
    .eq("username", username)
    .maybeSingle();
  
  if (existingErr) {
    if (/username|schema cache|column/i.test(existingErr.message)) {
      return NextResponse.json(
        { error: "Kolonnen 'username' mangler på users. Kør supabase/migrations/004_child_username.sql i Supabase SQL Editor." },
        { status: 503 }
      );
    }
    console.error("[create-child] Error checking existing username:", existingErr);
    return NextResponse.json({ 
      error: existingErr.message,
      details: "Fejl ved tjek af eksisterende brugernavn"
    }, { status: 500 });
  }
  
  if (existing) {
    console.log(`[create-child] Username ${username} already exists. Existing user:`, {
      id: existing.id,
      username: existing.username,
      first_name: existing.first_name,
      surname: existing.surname
    });
    const suggested = suggestAlternatives(first_name, surname);
    return NextResponse.json(
      {
        error: "En konto med dette navn findes allerede. For dit barns sikkerhed kræver vi deres rigtige fornavn og efternavn.",
        code: "NAME_TAKEN",
        message: "Behold det rigtige navn og gør det unikt ved at tilføje bynavnet, et nummer eller et kaldenavn efter efternavnet (f.eks. Jensen København, Jensen 2 eller Jensen AJ).",
        suggestedNames: suggested.map((s) => s.displayName),
        suggested: suggested.map(({ first_name: fn, surname: sn, displayName: dn, hint: h }) => ({ first_name: fn, surname: sn, displayName: dn, hint: h })),
        debug: {
          searchedUsername: username,
          existingUserId: existing.id,
          existingUsername: existing.username
        }
      },
      { status: 409 }
    );
  }
  
  console.log(`[create-child] Username ${username} is available, proceeding with child creation`);

  const syntheticEmail = `child-${crypto.randomUUID()}@family.local`;

  const { data: newAuthUser, error: createErr } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: pin,
    email_confirm: true,
  });

  if (createErr) {
    return NextResponse.json({ error: createErr.message }, { status: 400 });
  }
  if (!newAuthUser.user) {
    return NextResponse.json({ error: "Kunne ikke oprette bruger" }, { status: 500 });
  }

  const childId = newAuthUser.user.id;

  // Update user with username, first_name, surname, and is_child = true
  // IMPORTANT: Set is_child = true so the child appears in searches
  const { error: updateErr } = await admin
    .from("users")
    .update({ username, first_name, surname, is_child: true })
    .eq("id", childId);

  if (updateErr) {
    // Check if is_child column is missing
    const isChildColumnMissing = /is_child|schema cache|column/i.test(updateErr.message);
    
    if (/first_name|surname|avatar_url|schema cache|column/i.test(updateErr.message)) {
      // Try fallback: update without is_child if column doesn't exist
      const fallbackUpdate: { username: string; is_child?: boolean } = { username };
      if (!isChildColumnMissing) {
        fallbackUpdate.is_child = true;
      }
      const { error: fallbackErr } = await admin.from("users").update(fallbackUpdate).eq("id", childId);
      if (fallbackErr) {
        return NextResponse.json(
          { error: "Manglende kolonner på users. Kør migrations 004, 005, 006 og 011 (username, first_name, surname, avatar_url, is_child) i Supabase SQL Editor." },
          { status: 503 }
        );
      }
      // If is_child column was missing, try to update it separately after other columns are set
      if (isChildColumnMissing) {
        // Column doesn't exist - migration 011 not run, but child will still work with username check
        console.warn("[create-child] is_child column missing - child created but may not appear in searches until migration 011 is run");
      }
    } else if (/username|schema cache|column/i.test(updateErr.message)) {
      return NextResponse.json(
        { error: "Manglende kolonner på users. Kør migrations 004, 005, 006 og 011 i Supabase SQL Editor." },
        { status: 503 }
      );
    } else {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  // Try to insert with child_pin first, fallback without it if column doesn't exist
  let linkInsertData: {
    parent_id: string;
    child_id: string;
    surveillance_level: string;
    child_pin?: string;
  } = {
    parent_id: parentUser.id,
    child_id: childId,
    surveillance_level: surveillance_level,
    child_pin: pin, // Store PIN for later retrieval
  };

  let { error: linkErr } = await admin.from("parent_child_links").insert(linkInsertData);

  // If child_pin column doesn't exist, try without it
  if (linkErr && /child_pin|schema cache|column/i.test(linkErr.message)) {
    console.warn("[create-child] child_pin column missing - inserting without PIN. Run migration 025_add_child_pin.sql");
    // Remove child_pin and try again
    delete linkInsertData.child_pin;
    const { error: retryErr } = await admin.from("parent_child_links").insert(linkInsertData);
    if (retryErr) {
      linkErr = retryErr;
    } else {
      linkErr = null; // Success without PIN
    }
  }

  if (linkErr) {
    if (linkErr.code === "23505") {
      return NextResponse.json({ error: "Barnet er allerede tilknyttet" }, { status: 409 });
    }
    return NextResponse.json({ 
      error: linkErr.message,
      hint: /child_pin|schema cache|column/i.test(linkErr.message) 
        ? "Kør migration 025_add_child_pin.sql i Supabase SQL Editor for at gemme PIN." 
        : undefined
    }, { status: 500 });
  }

  // Ensure bucket exists (create if missing), then upload child photo. Roll back child if upload fails.
  await ensureBucketExists(admin as any);

  const ext = photoFile.name?.split(".").pop()?.toLowerCase() || "jpg";
  const safeExt = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
  const storagePath = `${CHILD_PHOTOS_PREFIX}/${childId}.${safeExt}`;
  const buffer = Buffer.from(await photoFile.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from(CHILD_PHOTOS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: photoFile.type || "image/jpeg",
      upsert: true,
    });

  if (uploadErr) {
    await admin.from("parent_child_links").delete().eq("child_id", childId);
    await admin.from("users").delete().eq("id", childId);
    await admin.auth.admin.deleteUser(childId);
    const detail = uploadErr.message || String(uploadErr);
    return NextResponse.json(
      {
        error: "Kunne ikke uploade foto. Prøv igen. Sørg for at Storage er aktiveret i dit Supabase projekt.",
        detail: process.env.NODE_ENV === "development" ? detail : undefined,
      },
      { status: 500 }
    );
  }

  // Get public URL for the uploaded photo
  // This URL will be stored in avatar_url column so the child's photo appears as their avatar
  const urlData = admin.storage.from(CHILD_PHOTOS_BUCKET).getPublicUrl(storagePath);
  const avatarUrl = (urlData as any)?.data?.publicUrl || (urlData as any)?.publicUrl;
  
  if (!avatarUrl) {
    console.error(`[create-child] Failed to get public URL for uploaded photo at path: ${storagePath}`);
    // Try to construct URL manually as fallback
    const manualUrl = `${supabaseUrl}/storage/v1/object/public/${CHILD_PHOTOS_BUCKET}/${storagePath}`;
    console.log(`[create-child] Using manual URL fallback: ${manualUrl}`);
    
    // Update with manual URL
    const { error: avatarUpdateErr } = await admin
      .from("users")
      .update({ avatar_url: manualUrl })
      .eq("id", childId);
    
    if (avatarUpdateErr && !/avatar_url|schema cache|column/i.test(avatarUpdateErr.message)) {
      return NextResponse.json(
        { ok: true, child_id: childId, username, displayName: toDisplayName(first_name, surname), error: "Foto uploadet men kunne ikke gemme profil link.", avatarUrl: manualUrl },
        { status: 200 }
      );
    }
  } else {
    // Log for debugging
    console.log(`[create-child] Photo uploaded to: ${storagePath}`);
    console.log(`[create-child] Public URL: ${avatarUrl}`);
    console.log(`[create-child] Updating avatar_url for child: ${childId}`);
    
    // Update the child's avatar_url in the users table with the uploaded photo URL
    const { error: avatarUpdateErr } = await admin
      .from("users")
      .update({ avatar_url: avatarUrl })
      .eq("id", childId);

    if (avatarUpdateErr) {
      // Log the error for debugging
      console.error(`[create-child] Error updating avatar_url:`, avatarUpdateErr);
      
      if (/avatar_url|schema cache|column/i.test(avatarUpdateErr.message)) {
        // Column might not exist yet; child is still created with photo uploaded
        console.warn(`[create-child] avatar_url column missing - photo uploaded but not linked to profile`);
      } else {
        // Non-schema error; leave child as-is but report
        return NextResponse.json(
          { ok: true, child_id: childId, username, displayName: toDisplayName(first_name, surname), error: "Photo uploaded but could not save profile link.", avatarUrl },
          { status: 200 }
        );
      }
    } else {
      console.log(`[create-child] Successfully updated avatar_url for child ${childId} with URL: ${avatarUrl}`);
    }
  }

  let invitationLink = "";
  try {
    const inviteToken = signInviteToken(childId);
    invitationLink = `${appUrl}/invite/child/${inviteToken}`;
  } catch {
    // INVITE_SECRET not set; skip link
  }

  const displayName = toDisplayName(first_name, surname);
  return NextResponse.json({
    ok: true,
    child_id: childId,
    username,
    displayName,
    invitationLink: invitationLink || undefined,
    message: invitationLink
      ? "Børnekonto oprettet. Del invitationslinket med dit barn så de kan åbne appen og indtaste deres PIN."
      : "Børnekonto oprettet. De kan logge ind på Barn login med deres fulde navn og PIN.",
  });
}
