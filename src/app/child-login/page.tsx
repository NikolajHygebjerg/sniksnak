"use client";

/**
 * Child login: username + PIN (no email).
 * Child can only use the app if a parent created their account via Parent view.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
  const [requestingLogin, setRequestingLogin] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fn = firstName.trim();
    const sn = surname.trim();
    const p = pin.trim();
    if (!fn || !sn || !p) {
      setError("Indtast dit fornavn, efternavn og PIN.");
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
      setError(data.error ?? "Kunne ikke finde din konto. En forælder skal oprette den først.");
      return;
    }

    const email = data.email as string;
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password: p,
    });

    setLoading(false);
    if (signInErr) {
      setError(signInErr.message === "Invalid login credentials" ? "Forkert PIN." : signInErr.message);
      return;
    }

    router.push("/chats");
    router.refresh();
  }

  async function handleRequestLogin() {
    const fn = firstName.trim();
    const sn = surname.trim();
    if (!fn || !sn) {
      setError("Indtast dit fornavn og efternavn for at anmode om loginoplysninger.");
      return;
    }
    
    setRequestingLogin(true);
    setError(null);
    setRequestMessage(null);
    
    try {
      const res = await fetch("/api/child/request-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: fn, surname: sn }),
      });
      
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunne ikke sende anmodning.");
        setRequestingLogin(false);
        return;
      }
      
      setRequestMessage("Loginoplysninger er sendt til din forældres email. Tjek med dem for at få dine loginoplysninger.");
      setRequestingLogin(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Der opstod en fejl");
      setRequestingLogin(false);
    }
  }

  async function handleCopyInvitation() {
    const fn = firstName.trim();
    const sn = surname.trim();
    if (!fn || !sn) {
      setError("Indtast dit fornavn og efternavn først.");
      return;
    }
    
    // Generate a simple invitation message
    const appUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
    const invitationText = `Hej! Jeg vil gerne bruge Sniksnak Chat. Kan du oprette en konto for mig?\n\nMit navn er: ${fn} ${sn}\n\nOpret min konto her: ${appUrl}/parent/create-child`;
    
    try {
      await navigator.clipboard.writeText(invitationText);
      setRequestMessage("Invitation kopieret! Send den til din forælder.");
    } catch (err) {
      setError("Kunne ikke kopiere invitation. Prøv at kopiere teksten manuelt.");
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#C4E6CA]">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex-shrink-0 flex justify-center">
          <Image src="/logo.svg" alt="Sniksnak Chat" width={156} height={156} className="w-[156px] h-[156px]" />
        </div>
        
        <p className="text-sm text-gray-500 text-center" style={{ fontFamily: 'Arial, sans-serif' }}>
          Log ind med det fornavn og efternavn din forælder har sat for dig, og din PIN.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert" style={{ fontFamily: 'Arial, sans-serif' }}>
              {error}
            </p>
          )}
          
          {requestMessage && (
            <p className="text-sm text-green-600" role="status" style={{ fontFamily: 'Arial, sans-serif' }}>
              {requestMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-[#E0785B] text-white font-medium rounded-md hover:bg-[#D06A4F] disabled:opacity-50"
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            {loading ? "Logger ind…" : "Log ind"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500" style={{ fontFamily: 'Arial, sans-serif' }}>
          Ingen konto? En forælder skal oprette en for dig.{" "}
          <button
            type="button"
            onClick={handleCopyInvitation}
            className="text-[#E0785B] hover:underline"
          >
            Tryk her for at kopiere en invitation du kan sende til dine forældre.
          </button>
        </p>

        <p className="text-center text-sm text-gray-500" style={{ fontFamily: 'Arial, sans-serif' }}>
          Har du allerede en konto, men kan ikke huske dit navn eller PIN?{" "}
          <button
            type="button"
            onClick={handleRequestLogin}
            disabled={requestingLogin}
            className="text-[#E0785B] hover:underline disabled:opacity-50"
          >
            {requestingLogin ? "Sender…" : "Klik her for at få tilsendt navn og kode til din forælder"}
          </button>
        </p>

        <p className="text-center">
          <Link href="/login" className="text-sm text-[#E0785B] hover:underline" style={{ fontFamily: 'Arial, sans-serif' }}>
            Forælder login
          </Link>
        </p>
      </div>
    </main>
  );
}
