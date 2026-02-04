"use client";

/**
 * Parent settings page: edit own profile, logout, delete account.
 */
import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export default function ParentSettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isActive = (path: string) => pathname === path;

  useEffect(() => {
    async function loadUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setEmail(session.user.email || "");
        
        // Load user profile data (first_name, surname)
        const { data: userData } = await supabase
          .from("users")
          .select("first_name, surname")
          .eq("id", session.user.id)
          .maybeSingle();
        
        if (userData) {
          setFirstName(userData.first_name || "");
          setSurname(userData.surname || "");
        }
      } else {
        router.replace("/login");
      }
      setLoading(false);
    }
    loadUser();
  }, [router]);

  async function handleSave() {
    if (!user || saving) return;
    const fn = firstName.trim();
    const sn = surname.trim();
    
    if (!fn || !sn) {
      setError("Indtast både fornavn og efternavn.");
      return;
    }
    if (fn.length < 2 || sn.length < 2) {
      setError("Fornavn og efternavn skal være mindst 2 tegn.");
      return;
    }
    
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      // Update email in auth
      const { error: updateError } = await supabase.auth.updateUser({
        email: email.trim(),
      });

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      // Update first_name and surname in users table
      const { error: profileError } = await supabase
        .from("users")
        .update({ first_name: fn, surname: sn })
        .eq("id", user.id);

      if (profileError) {
        setError(profileError.message);
        setSaving(false);
        return;
      }

      setMessage({ type: "success", text: "Profil opdateret." });
      setSaving(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Der opstod en fejl");
      setSaving(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  async function handleDeleteAccount() {
    if (!user || deleting) return;
    const confirmed = confirm(
      "Er du sikker på, at du vil slette din profil? Dette kan ikke fortrydes. Alle dine data vil blive slettet."
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);

    try {
      // Delete all parent_child_links first
      const { error: linksError } = await supabase
        .from("parent_child_links")
        .delete()
        .eq("parent_id", user.id);

      if (linksError) {
        console.error("Error deleting parent_child_links:", linksError);
      }

      // Delete user account
      const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);

      if (deleteError) {
        // If admin API is not available, try to delete from users table
        const { error: userDeleteError } = await supabase
          .from("users")
          .delete()
          .eq("id", user.id);

        if (userDeleteError) {
          setError(userDeleteError.message);
          setDeleting(false);
          return;
        }
      }

      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Der opstod en fejl ved sletning");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-500">Indlæser…</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen p-6 bg-[#C4E6CA] pb-20">
      <div className="max-w-2xl mx-auto">
        {/* Logo */}
        <div className="flex-shrink-0 flex justify-center mb-4">
          <Image src="/logo.svg" alt="Sniksnak Chat" width={156} height={156} className="w-[156px] h-[156px]" loading="eager" />
        </div>

        <h1 className="text-2xl font-semibold mb-4" style={{ fontFamily: 'Arial, sans-serif' }}>Indstillinger</h1>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {message && (
          <div className={`mb-4 rounded-lg border p-4 ${
            message.type === "success" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
          }`} role="status">
            <p className={`text-sm ${message.type === "success" ? "text-green-800" : "text-red-800"}`}>
              {message.text}
            </p>
          </div>
        )}

        <section className="rounded-3xl border border-gray-200 bg-[#E2F5E6] p-4 sm:p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4" style={{ fontFamily: 'Arial, sans-serif' }}>Rediger profil</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="settings-firstname" className="block text-sm font-medium text-gray-700 mb-1" style={{ fontFamily: 'Arial, sans-serif' }}>
                  Fornavn
                </label>
                <input
                  id="settings-firstname"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={saving}
                  minLength={2}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#E0785B] focus:outline-none focus:ring-1 focus:ring-[#E0785B] disabled:bg-gray-100"
                  style={{ fontFamily: 'Arial, sans-serif' }}
                />
              </div>
              <div>
                <label htmlFor="settings-surname" className="block text-sm font-medium text-gray-700 mb-1" style={{ fontFamily: 'Arial, sans-serif' }}>
                  Efternavn
                </label>
                <input
                  id="settings-surname"
                  type="text"
                  value={surname}
                  onChange={(e) => setSurname(e.target.value)}
                  disabled={saving}
                  minLength={2}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#E0785B] focus:outline-none focus:ring-1 focus:ring-[#E0785B] disabled:bg-gray-100"
                  style={{ fontFamily: 'Arial, sans-serif' }}
                />
              </div>
            </div>
            <div>
              <label htmlFor="settings-email" className="block text-sm font-medium text-gray-700 mb-1" style={{ fontFamily: 'Arial, sans-serif' }}>
                Email
              </label>
              <input
                id="settings-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#E0785B] focus:outline-none focus:ring-1 focus:ring-[#E0785B] disabled:bg-gray-100"
                style={{ fontFamily: 'Arial, sans-serif' }}
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full rounded-lg bg-[#E0785B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 disabled:opacity-50"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              {saving ? "Gemmer…" : "Gem ændringer"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-[#E2F5E6] p-4 sm:p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4" style={{ fontFamily: 'Arial, sans-serif' }}>Konto</h2>
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              Log ud
            </button>
            <button
              type="button"
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="w-full rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              {deleting ? "Sletter…" : "Slet profil"}
            </button>
          </div>
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
