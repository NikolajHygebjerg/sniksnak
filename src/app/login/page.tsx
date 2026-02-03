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
  const [parentFirstName, setParentFirstName] = useState("");
  const [parentSurname, setParentSurname] = useState("");
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
        const fn = parentFirstName.trim();
        const sn = parentSurname.trim();
        if (!fn || !sn) {
          setError("Indtast både fornavn og efternavn.");
          setLoading(false);
          return;
        }
        if (fn.length < 2 || sn.length < 2) {
          setError("Fornavn og efternavn skal være mindst 2 tegn.");
          setLoading(false);
          return;
        }
        
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data?.user && !data.user.identities?.length) {
          setMessage("En konto med denne email findes allerede. Log ind i stedet.");
          setLoading(false);
          return;
        }
        
        // Update user profile with first_name and surname
        if (data?.user) {
          const { error: updateErr } = await supabase
            .from("users")
            .update({ first_name: fn, surname: sn })
            .eq("id", data.user.id);
          
          if (updateErr) {
            console.error("Error updating user profile:", updateErr);
            // Continue anyway - user is created, profile update can happen later
          }
        }
        
        if (data?.session) {
          router.push("/parent");
          router.refresh();
          return;
        }
        setMessage("Tjek din email for at bekræfte din konto, og log derefter ind.");
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
      setError(err instanceof Error ? err.message : "Noget gik galt.");
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
      setError("Indtast dit fornavn, efternavn og PIN.");
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
        setError(data.error ?? "Kunne ikke finde din konto. En forælder skal oprette den først.");
        return;
      }

      const childEmail = data.email as string;
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: childEmail,
        password: p,
      });

      if (signInErr) {
        setError(signInErr.message === "Invalid login credentials" ? "Forkert PIN." : signInErr.message);
        return;
      }

      router.push("/chats");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Noget gik galt.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#C4E6CA]">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-center">Sniksnak Chat</h1>
        
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
                ? "border-b-2 border-[#E0785B] text-[#E0785B]"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Forælder Login
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
                ? "border-b-2 border-[#E0785B] text-[#E0785B]"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Barn Login
          </button>
        </div>

        {mode === "parent" ? (
          <>
            <p className="text-sm text-gray-500 text-center">
              {isSignUp ? "Opret en forældrekonto (email + adgangskode)" : "Log ind med din email og adgangskode"}
            </p>

            <form onSubmit={handleParentSubmit} className="space-y-4">
              {isSignUp && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="parent-firstname" className="block text-sm font-medium text-gray-700 mb-1">
                      Fornavn
                    </label>
                    <input
                      id="parent-firstname"
                      type="text"
                      value={parentFirstName}
                      onChange={(e) => setParentFirstName(e.target.value)}
                      required={isSignUp}
                      autoComplete="given-name"
                      minLength={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
                    />
                  </div>
                  <div>
                    <label htmlFor="parent-surname" className="block text-sm font-medium text-gray-700 mb-1">
                      Efternavn
                    </label>
                    <input
                      id="parent-surname"
                      type="text"
                      value={parentSurname}
                      onChange={(e) => setParentSurname(e.target.value)}
                      required={isSignUp}
                      autoComplete="family-name"
                      minLength={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
                    />
                  </div>
                </div>
              )}
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Adgangskode
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
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
                className="w-full py-2 px-4 bg-[#E0785B] text-white font-medium rounded-md hover:bg-[#D06A4F] disabled:opacity-50"
              >
                {loading ? "…" : isSignUp ? "Tilmeld dig" : "Log ind"}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500">
              {isSignUp ? "Har du allerede en konto? " : "Ingen konto endnu? "}
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                  setMessage(null);
                  if (!isSignUp) {
                    // Reset parent name fields when switching to signup
                    setParentFirstName("");
                    setParentSurname("");
                  }
                }}
                className="text-[#E0785B] hover:underline"
              >
                {isSignUp ? "Log ind" : "Tilmeld dig"}
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 text-center">
              Log ind med det fornavn og efternavn din forælder har sat for dig, og din PIN.
            </p>

            <form onSubmit={handleChildSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="child-firstname" className="block text-sm font-medium text-gray-700 mb-1">
                    Fornavn
                  </label>
                  <input
                    id="child-firstname"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    autoComplete="given-name"
                    placeholder="Fornavn"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
                  />
                </div>
                <div>
                  <label htmlFor="child-surname" className="block text-sm font-medium text-gray-700 mb-1">
                    Efternavn
                  </label>
                  <input
                    id="child-surname"
                    type="text"
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    required
                    autoComplete="family-name"
                    placeholder="Efternavn"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
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
                  placeholder="Din PIN"
                  inputMode="numeric"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
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
                className="w-full py-2 px-4 bg-[#E0785B] text-white font-medium rounded-md hover:bg-[#D06A4F] disabled:opacity-50"
              >
                {loading ? "Logger ind…" : "Log ind"}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500">
              Ingen konto? En forælder skal oprette en for dig (fornavn + efternavn) i Forældrevisning og dele invitationslinket.
            </p>
          </>
        )}

        <p className="text-center text-sm text-gray-500">
          <Link href="/" className="text-gray-400 hover:text-gray-600">
            ← Hjem
          </Link>
        </p>
      </div>
    </main>
  );
}
