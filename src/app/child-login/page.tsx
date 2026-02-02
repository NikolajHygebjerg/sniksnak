"use client";

/**
 * Child login: username + PIN (no email).
 * Child can only use the app if a parent created their account via Parent view.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

/** Build login username from first name + surname (same as API) */
function toUsername(firstName: string, surname: string): string {
  const f = firstName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "first";
  const s = surname.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "surname";
  return `${f}_${s}`;
}

export default function ChildLoginPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fn = firstName.trim();
    const sn = surname.trim();
    const p = pin.trim();
    if (!fn || !sn || !p) {
      setError("Enter your first name, surname and PIN.");
      return;
    }
    setLoading(true);
    const username = toUsername(fn, sn);

    const res = await fetch("/api/auth/child-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Could not find your account. A parent must create it first.");
      return;
    }

    const email = data.email as string;
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password: p,
    });

    setLoading(false);
    if (signInErr) {
      setError(signInErr.message === "Invalid login credentials" ? "Wrong PIN." : signInErr.message);
      return;
    }

    router.push("/chats");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-center">Chat App</h1>
        <p className="text-sm text-gray-500 text-center">
          Log in with the first name and surname your parent set for you, and your PIN.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="child-firstname" className="block text-sm font-medium text-gray-700 mb-1">
                First name
              </label>
              <input
                id="child-firstname"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="given-name"
                placeholder="First name"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="child-surname" className="block text-sm font-medium text-gray-700 mb-1">
                Surname
              </label>
              <input
                id="child-surname"
                type="text"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                required
                autoComplete="family-name"
                placeholder="Surname"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label htmlFor="child-pin" className="block text-sm font-medium text-gray-700 mb-1">
              PIN
            </label>
            <input
              id="child-pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              minLength={4}
              maxLength={12}
              autoComplete="off"
              placeholder="Your PIN"
              inputMode="numeric"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          No account? A parent must create one for you (first name + surname) in Parent view and share the invitation link.
        </p>

        <p className="text-center">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">
            ← Home
          </Link>
          {" · "}
          <Link href="/login" className="text-sm text-blue-600 hover:underline">
            Parent login
          </Link>
        </p>
      </div>
    </main>
  );
}
