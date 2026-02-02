"use client";

/**
 * Home: choose Parent login (email) or Child login (username + PIN).
 * If already logged in, redirect to chats.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        // Safe error logging
        try {
          if (error && typeof error === "object" && Object.keys(error).length > 0) {
            console.error("Error getting session:", error);
          } else {
            console.error("Unknown error occurred:", error);
          }
        } catch (logErr) {
          console.error("Error occurred but could not be logged:", String(error || "Unknown"));
        }
        setLoading(false);
        return;
      }
      if (session?.user) {
        router.replace("/chats");
      } else {
        setLoading(false);
      }
    }).catch((err) => {
      // Safe error logging
      try {
        if (err && typeof err === "object" && Object.keys(err).length > 0) {
          console.error("Exception getting session:", err);
        } else {
          console.error("Unknown error occurred:", err);
        }
      } catch (logErr) {
        console.error("Error occurred but could not be logged:", String(err || "Unknown"));
      }
      setLoading(false);
    });
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Chat App</h1>
        <p className="text-sm text-gray-500">
          Parents sign up with email, then create child accounts using the child&apos;s real name and a PIN. Children can only use the app if a parent created their account (no anonymous/incognito names).
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="block w-full py-3 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Parent login
          </Link>
          <Link
            href="/child-login"
            className="block w-full py-3 px-4 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Child login
          </Link>
        </div>
        <p className="text-xs text-gray-400">
          Parents: sign up or log in with email. Children: log in with the name your parent set (your real name) and PIN.
        </p>
      </div>
    </main>
  );
}
