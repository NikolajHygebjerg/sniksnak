"use client";

/**
 * Parent create child page: form to create a child account.
 */
import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export default function ParentCreateChildPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [createFirstName, setCreateFirstName] = useState("");
  const [createSurname, setCreateSurname] = useState("");
  const [createPin, setCreatePin] = useState("");
  const [createSurveillanceLevel, setCreateSurveillanceLevel] = useState<"strict" | "medium" | "mild">("medium");
  const [createPhotoFile, setCreatePhotoFile] = useState<File | null>(null);
  const [createPhotoPreview, setCreatePhotoPreview] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createMessage, setCreateMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [nameTaken, setNameTaken] = useState(false);
  const [duplicateNameSuffix, setDuplicateNameSuffix] = useState("");
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [linkMessage, setLinkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showLinkByEmail, setShowLinkByEmail] = useState(false);

  const isActive = (path: string) => pathname === path;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  useEffect(() => {
    async function loadUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
      } else {
        router.replace("/login");
      }
    }
    loadUser();
  }, [router]);

  async function handleCreateChild(e: React.FormEvent, suggested?: { first_name: string; surname: string }) {
    e.preventDefault();
    if (!user || createSubmitting) return;
    const first_name = (suggested?.first_name ?? createFirstName).trim();
    const surname = (suggested?.surname ?? createSurname).trim();
    const pin = createPin.trim();
    if (!first_name || !surname) {
      setCreateMessage({ type: "error", text: "Indtast både fornavn og efternavn." });
      return;
    }
    if (first_name.length < 2) {
      setCreateMessage({ type: "error", text: "Fornavn skal være mindst 2 tegn." });
      return;
    }
    if (surname.length < 2) {
      setCreateMessage({ type: "error", text: "Efternavn skal være mindst 2 tegn." });
      return;
    }
    const anonymousNames = ["incognito", "anonymous", "anon", "unknown", "hidden", "secret", "nickname", "fake", "test", "demo"];
    if (anonymousNames.includes(first_name.toLowerCase()) || anonymousNames.includes(surname.toLowerCase())) {
      setCreateMessage({ type: "error", text: "Brug dit barns rigtige fornavn og efternavn." });
      return;
    }
    if (pin.length < 4 || pin.length > 12) {
      setCreateMessage({ type: "error", text: "PIN skal være 4–12 tegn." });
      return;
    }
    if (!createPhotoFile || !createPhotoFile.type.startsWith("image/")) {
      setCreateMessage({ type: "error", text: "Et billede af dit barn er påkrævet. Upload venligst et klart billede af dit barn af sikkerhedsmæssige årsager." });
      return;
    }
    setCreateSubmitting(true);
    setCreateMessage(null);
    setNameTaken(false);
    setDuplicateNameSuffix("");
    setInvitationLink(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setCreateSubmitting(false);
      setCreateMessage({ type: "error", text: "Session udløbet. Log venligst ind igen." });
      return;
    }
    const formData = new FormData();
    formData.set("first_name", first_name);
    formData.set("surname", surname);
    formData.set("pin", pin);
    formData.set("surveillance_level", createSurveillanceLevel);
    formData.set("photo", createPhotoFile);
    const res = await fetch("/api/parent/create-child", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    setCreateSubmitting(false);
    if (!res.ok) {
      if (res.status === 409 && data.code === "NAME_TAKEN") {
        setNameTaken(true);
        setDuplicateNameSuffix("");
        setCreateMessage({ type: "error", text: data.error ?? "Dette navn er allerede i brug. Tilføj et bynavn, nummer eller kaldenavn i feltet nedenfor og klik Acceptér." });
      } else {
        const detail = data.detail ? ` (${data.detail})` : "";
        setCreateMessage({ type: "error", text: (data.error ?? "Kunne ikke oprette børnekonto.") + detail });
      }
      return;
    }
    setCreateFirstName("");
    setCreateSurname("");
    setCreatePin("");
    setCreatePhotoFile(null);
    if (createPhotoPreview) URL.revokeObjectURL(createPhotoPreview);
    setCreatePhotoPreview(null);
    setNameTaken(false);
    setDuplicateNameSuffix("");
    if (data.invitationLink) {
      setInvitationLink(data.invitationLink);
      setCreateMessage({ type: "success", text: `${data.displayName ?? first_name + " " + surname} er oprettet. Del invitationslinket nedenfor med dit barn.` });
    } else {
      setCreateMessage({ type: "success", text: `${data.displayName ?? first_name + " " + surname} kan logge ind på Barn login med deres fulde navn og PIN.` });
    }
    router.push("/parent/children");
  }

  async function handleLinkChild(e: React.FormEvent) {
    e.preventDefault();
    if (!user || linkSubmitting) return;
    const email = linkEmail.trim().toLowerCase();
    if (!email) {
      setLinkMessage({ type: "error", text: "Indtast barnets email." });
      return;
    }
    setLinkSubmitting(true);
    setLinkMessage(null);

    const { data: childUser, error: userErr } = await supabase
      .from("users")
      .select("id, email")
      .ilike("email", email)
      .maybeSingle();

    if (userErr || !childUser) {
      setLinkSubmitting(false);
      setLinkMessage({ type: "error", text: "Ingen konto fundet med den email." });
      return;
    }

    if (childUser.id === user.id) {
      setLinkSubmitting(false);
      setLinkMessage({ type: "error", text: "Du kan ikke tilknytte dig selv som barn." });
      return;
    }

    const { error: insertErr } = await supabase
      .from("parent_child_links")
      .insert({ parent_id: user.id, child_id: childUser.id })
      .select("id, parent_id, child_id")
      .single();

    setLinkSubmitting(false);
    if (insertErr) {
      if (insertErr.code === "23505") {
        setLinkMessage({ type: "error", text: "Dette barn er allerede tilknyttet." });
      } else {
        setLinkMessage({ type: "error", text: insertErr.message });
      }
      return;
    }

    setLinkEmail("");
    setLinkMessage({ type: "success", text: `${childUser.email} er nu tilknyttet som barn.` });
    router.push("/parent/children");
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-500">Indlæser…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 bg-[#C4E6CA] pb-20">
      <div className="max-w-2xl mx-auto">
        {/* Logo */}
        <div className="flex-shrink-0 flex justify-center mb-4">
          <Image src="/logo.svg" alt="Sniksnak Chat" width={156} height={156} className="w-[156px] h-[156px]" />
        </div>

        <h1 className="text-2xl font-semibold mb-4" style={{ fontFamily: 'Arial, sans-serif' }}>Opret barn</h1>
        <p className="text-gray-500 text-sm mb-4" style={{ fontFamily: 'Arial, sans-serif' }}>
          Dit barn kan kun bruge appen efter du har oprettet deres konto. Brug deres <strong>rigtige fornavn og efternavn</strong>, så de ikke kan chatte anonymt.
        </p>

        <section className="rounded-3xl border border-gray-200 bg-[#E2F5E6] p-4 sm:p-6 mb-6 w-full" aria-label="Opret børnekonto">
          <form onSubmit={(e) => handleCreateChild(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="parent-create-firstname" className="block text-sm font-medium text-gray-700 mb-1">
                  Fornavn
                </label>
                <input
                  id="parent-create-firstname"
                  type="text"
                  value={createFirstName}
                  onChange={(e) => setCreateFirstName(e.target.value)}
                  placeholder="f.eks. Alex"
                  disabled={createSubmitting}
                  autoComplete="given-name"
                  minLength={2}
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#E0785B] focus:outline-none focus:ring-1 focus:ring-[#E0785B] disabled:bg-gray-100"
                />
              </div>
              <div>
                <label htmlFor="parent-create-surname" className="block text-sm font-medium text-gray-700 mb-1">
                  Efternavn
                </label>
                <input
                  id="parent-create-surname"
                  type="text"
                  value={createSurname}
                  onChange={(e) => setCreateSurname(e.target.value)}
                  placeholder="f.eks. Jensen"
                  disabled={createSubmitting}
                  autoComplete="family-name"
                  minLength={2}
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#E0785B] focus:outline-none focus:ring-1 focus:ring-[#E0785B] disabled:bg-gray-100"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Brug dit barns rigtige fornavn og efternavn. Anonyme eller falske navne er ikke tilladt.
            </p>
            <div>
              <label htmlFor="parent-create-photo" className="block text-sm font-medium text-gray-700 mb-1">
                Billede af dit barn <span className="text-red-600">(påkrævet)</span>
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Dette skal være et klart billede af dit barn af sikkerhedsmæssige årsager. Det vil være synligt for andre brugere de chatter med.
              </p>
              <input
                id="parent-create-photo"
                type="file"
                accept="image/*"
                capture="user"
                required
                disabled={createSubmitting}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.type.startsWith("image/")) {
                    if (createPhotoPreview) URL.revokeObjectURL(createPhotoPreview);
                    setCreatePhotoFile(file);
                    setCreatePhotoPreview(URL.createObjectURL(file));
                    setCreateMessage(null);
                  } else if (file) {
                    setCreateMessage({ type: "error", text: "Vælg venligst en billedfil (f.eks. JPEG eller PNG)." });
                  }
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#E0785B] focus:outline-none focus:ring-1 focus:ring-[#E0785B] disabled:bg-gray-100 file:mr-3 file:rounded file:border-0 file:bg-[#E2F5E6] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[#E0785B]"
              />
              {createPhotoPreview && (
                <div className="mt-2">
                  <img
                    src={createPhotoPreview}
                    alt="Forhåndsvisning af barnets foto"
                    className="h-24 w-24 rounded-full object-cover border-2 border-gray-200"
                  />
                </div>
              )}
            </div>
            <div>
              <label htmlFor="parent-create-pin" className="block text-sm font-medium text-gray-700 mb-1">
                PIN (4–12 tegn; barnet vil bruge dette til at logge ind)
              </label>
              <input
                id="parent-create-pin"
                type="password"
                value={createPin}
                onChange={(e) => setCreatePin(e.target.value)}
                placeholder="••••"
                disabled={createSubmitting}
                minLength={4}
                maxLength={12}
                required
                autoComplete="off"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>
            {nameTaken && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900 mb-1">Vi kræver dit barns rigtige navn af sikkerhedsmæssige årsager</p>
                <p className="text-sm text-amber-800 mb-3">
                  En anden konto har allerede dette navn. Behold det rigtige fornavn og efternavn ovenfor, og tilføj et <strong>bynavn</strong>, <strong>nummer</strong> eller <strong>kaldenavn</strong> i feltet nedenfor for at gøre det unikt (f.eks. København, 2 eller AJ).
                </p>
                <label htmlFor="parent-duplicate-suffix" className="block text-sm font-medium text-amber-800 mb-1">
                  Bynavn, nummer eller kaldenavn at tilføje efter efternavnet
                </label>
                <div className="flex flex-wrap gap-2 items-end">
                  <input
                    id="parent-duplicate-suffix"
                    type="text"
                    value={duplicateNameSuffix}
                    onChange={(e) => {
                      setDuplicateNameSuffix(e.target.value);
                      setCreateMessage(null);
                    }}
                    placeholder="f.eks. København, 2 eller AJ"
                    disabled={createSubmitting}
                    className="flex-1 min-w-[160px] rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:bg-gray-100"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      const suffix = duplicateNameSuffix.trim();
                      if (!suffix) {
                        setCreateMessage({ type: "error", text: "Indtast et bynavn, nummer eller kaldenavn i feltet ovenfor." });
                        return;
                      }
                      if (!createPhotoFile) {
                        setCreateMessage({ type: "error", text: "Et billede af dit barn er påkrævet." });
                        return;
                      }
                      const surnameWithSuffix = `${createSurname.trim()} ${suffix}`;
                      handleCreateChild(e, { first_name: createFirstName.trim(), surname: surnameWithSuffix });
                    }}
                    disabled={createSubmitting || !createPhotoFile}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50"
                    title={!createPhotoFile ? "Upload et billede først" : undefined}
                  >
                    Acceptér og opret
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Overvågningsniveau
              </label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-white cursor-pointer">
                  <input
                    type="radio"
                    name="surveillance_level"
                    value="strict"
                    checked={createSurveillanceLevel === "strict"}
                    onChange={(e) => setCreateSurveillanceLevel(e.target.value as "strict")}
                    disabled={createSubmitting}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900">Streng</div>
                    <div className="text-xs text-gray-600">Adgang til dit barns chats og billeder</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-white cursor-pointer">
                  <input
                    type="radio"
                    name="surveillance_level"
                    value="medium"
                    checked={createSurveillanceLevel === "medium"}
                    onChange={(e) => setCreateSurveillanceLevel(e.target.value as "medium")}
                    disabled={createSubmitting}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900">Medium</div>
                    <div className="text-xs text-gray-600">Notifikationer når eksplicit sprog bruges (og derefter adgang til chatten)</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-white cursor-pointer">
                  <input
                    type="radio"
                    name="surveillance_level"
                    value="mild"
                    checked={createSurveillanceLevel === "mild"}
                    onChange={(e) => setCreateSurveillanceLevel(e.target.value as "mild")}
                    disabled={createSubmitting}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900">Mild</div>
                    <div className="text-xs text-gray-600">Modtag kun beskeder når dit barn flagger en dårlig besked</div>
                  </div>
                </label>
              </div>
            </div>
            <button
              type="submit"
              disabled={createSubmitting || !createPhotoFile}
              className="w-full rounded-lg bg-[#E0785B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createSubmitting ? "Opretter…" : "Opret børnekonto"}
            </button>
          </form>
          {invitationLink && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
              <p className="text-sm font-medium text-green-800 mb-2">Invitationslink til dit barn</p>
              <p className="text-xs text-green-700 mb-2">
                Del dette link med dit barn. De åbner det, indtaster deres PIN, og kan begynde at bruge appen.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={invitationLink}
                  className="flex-1 rounded border border-green-300 bg-white px-2 py-1.5 text-sm text-gray-800"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(invitationLink);
                    setCreateMessage({ type: "success", text: "Link kopieret til udklipsholder." });
                  }}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  Kopiér link
                </button>
              </div>
            </div>
          )}
          {createMessage && (
            <p
              className={`mt-2 text-sm ${createMessage.type === "success" ? "text-green-600" : "text-red-600"}`}
              role="status"
            >
              {createMessage.text}
            </p>
          )}

          <p className="mt-4 text-sm text-gray-500">
            <button
              type="button"
              onClick={() => setShowLinkByEmail(!showLinkByEmail)}
              className="text-[#E0785B] hover:underline"
            >
              {showLinkByEmail ? "Skjul" : "Tilknyt en eksisterende konto via email"}
            </button>
          </p>
          {showLinkByEmail && (
            <form onSubmit={handleLinkChild} className="mt-3 flex flex-wrap items-end gap-2 pt-3 border-t border-gray-100">
              <label htmlFor="parent-link-email" className="sr-only">
                Barnets email
              </label>
              <input
                id="parent-link-email"
                type="email"
                value={linkEmail}
                onChange={(e) => setLinkEmail(e.target.value)}
                placeholder="barn@eksempel.dk"
                disabled={linkSubmitting}
                className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
              />
              <button
                type="submit"
                disabled={linkSubmitting}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 disabled:opacity-50"
              >
                {linkSubmitting ? "Tilknytter…" : "Tilknyt via email"}
              </button>
            </form>
          )}
          {showLinkByEmail && linkMessage && (
            <p
              className={`mt-2 text-sm ${linkMessage.type === "success" ? "text-green-600" : "text-red-600"}`}
              role="status"
            >
              {linkMessage.text}
            </p>
          )}
        </section>
      </div>

      {/* Bottom Navigation Bar for Parents */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom z-50">
        <div className="max-w-2xl mx-auto flex items-center justify-around px-2 py-1">
          <Link
            href="/parent"
            className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
              isActive("/parent") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Chat"
          >
            <Image src="/chaticon.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
          <Link
            href="/parent/create-child"
            className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
              isActive("/parent/create-child") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Opret barn"
          >
            <Image src="/parentcontrol.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
          <Link
            href="/parent/children"
            className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
              isActive("/parent/children") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Mine børn"
          >
            <Image src="/children.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
          <Link
            href="/parent/settings"
            className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
              isActive("/parent/settings") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Indstillinger"
          >
            <Image src="/Settings.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
        </div>
      </nav>
    </main>
  );
}
