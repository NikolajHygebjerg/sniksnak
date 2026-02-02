"use client";

/**
 * Child invitation: parent shares this link; child opens it and enters their PIN to join the app.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function InviteChildPage() {
  const params = useParams();
  const router = useRouter();
  const token = params?.token as string | undefined;
  const [firstName, setFirstName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Invalid link");
      return;
    }
    fetch(`/api/invite/child/${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.first_name != null && data.email != null) {
          setFirstName(data.first_name);
          setEmail(data.email);
        } else {
          setError(data.error ?? "Invalid or expired link");
        }
      })
      .catch(() => setError("Could not load invitation"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !pin.trim()) return;
    setError(null);
    setSubmitting(true);
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password: pin.trim(),
    });
    setSubmitting(false);
    if (signInErr) {
      setError(signInErr.message === "Invalid login credentials" ? "Wrong PIN." : signInErr.message);
      return;
    }
    router.push("/chats");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-500">Loading invitation…</p>
      </main>
    );
  }

  if (error && !firstName) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6">
        <p className="text-red-600 text-center mb-4">{error}</p>
        <p className="text-sm text-gray-500 text-center">
          The link may have expired (invitations last 7 days). Ask your parent to create a new invitation from Parent view.
        </p>
        <Link href="/" className="mt-6 text-sm text-blue-600 hover:underline">
          ← Home
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-center">Chat App</h1>
        <p className="text-sm text-gray-500 text-center">
          Your parent set up an account for you. Enter the PIN they gave you to get started.
        </p>
        {firstName && (
          <p className="text-center font-medium text-gray-800">
            Welcome, {firstName}!
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="invite-pin" className="block text-sm font-medium text-gray-700 mb-1">
              PIN
            </label>
            <input
              id="invite-pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              minLength={4}
              maxLength={12}
              autoComplete="off"
              placeholder="Enter your PIN"
              inputMode="numeric"
              disabled={submitting}
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
            disabled={submitting}
            className="w-full py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Logging in…" : "Open app"}
          </button>
        </form>
        <p className="text-center">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">
            ← Home
          </Link>
        </p>
      </div>
    </main>
  );
}
