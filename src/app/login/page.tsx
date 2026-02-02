"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type LoginMode = "parent" | "child";

/** Build login username from first name + surname (same as API) */
function toUsername(firstName: string, surname: string): string {
  const f = firstName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "first";
  const s = surname.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "surname";
  return `${f}_${s}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("parent");
  
  // Parent login fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  
  // Child login fields
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [pin, setPin] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleParentSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data?.user && !data.user.identities?.length) {
          setMessage("An account with this email already exists. Log in instead.");
          return;
        }
        if (data?.session) {
          router.push("/parent");
          router.refresh();
          return;
        }
        setMessage("Check your email to confirm your account, then log in.");
        return;
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (err) throw err;
        router.push("/parent");
        router.refresh();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleChildSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const fn = firstName.trim();
    const sn = surname.trim();
    const p = pin.trim();
    if (!fn || !sn || !p) {
      setError("Enter your first name, surname and PIN.");
      return;
    }
    setLoading(true);
    const username = toUsername(fn, sn);

    try {
      const res = await fetch("/api/auth/child-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Could not find your account. A parent must create it first.");
        return;
      }

      const childEmail = data.email as string;
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: childEmail,
        password: p,
      });

      if (signInErr) {
        setError(signInErr.message === "Invalid login credentials" ? "Wrong PIN." : signInErr.message);
        return;
      }

      router.push("/chats");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-center">Chat App</h1>
        
        {/* Mode selector tabs */}
        <div className="flex gap-2 border-b border-gray-200">
          <button
            type="button"
            onClick={() => {
              setMode("parent");
              setError(null);
              setMessage(null);
            }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === "parent"
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Parent Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("child");
              setError(null);
              setMessage(null);
            }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === "child"
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Child Login
          </button>
        </div>

        {mode === "parent" ? (
          <>
            <p className="text-sm text-gray-500 text-center">
              {isSignUp ? "Create a parent account (email + password)" : "Log in with your email and password"}
            </p>

            <form onSubmit={handleParentSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="text-sm text-green-600" role="status">
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "…" : isSignUp ? "Sign up" : "Log in"}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500">
              {isSignUp ? "Already have an account? " : "No account yet? "}
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                  setMessage(null);
                }}
                className="text-blue-600 hover:underline"
              >
                {isSignUp ? "Log in" : "Sign up"}
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 text-center">
              Log in with the first name and surname your parent set for you, and your PIN.
            </p>

            <form onSubmit={handleChildSubmit} className="space-y-4">
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
              {message && (
                <p className="text-sm text-green-600" role="status">
                  {message}
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
          </>
        )}

        <p className="text-center text-sm text-gray-500">
          <Link href="/" className="text-gray-400 hover:text-gray-600">
            ← Home
          </Link>
        </p>
      </div>
    </main>
  );
}
