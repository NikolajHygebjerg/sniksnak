"use client";

/**
 * Home: choose Parent login (email) or Child login (username + PIN).
 * If already logged in, redirect to chats.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-[#F0FDF9] to-white">
        <div className="flex flex-col items-center space-y-4">
          <div className="relative w-32 h-32 flex items-center justify-center">
            <div className="absolute inset-0 bg-[#C2EDD8] rounded-full animate-pulse"></div>
            <Image 
              src="/sniksnak-logo.png" 
              alt="Sniksnak Chat Logo" 
              width={112}
              height={112}
              className="relative object-contain opacity-80"
              priority
            />
          </div>
          <p className="text-gray-500">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-b from-[#F0FDF9] to-white">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Logo */}
        <div className="flex flex-col items-center space-y-4">
          <div className="relative w-48 h-48 flex items-center justify-center">
            <div className="absolute inset-0 bg-[#C2EDD8] rounded-full"></div>
            <Image 
              src="/sniksnak-logo.png" 
              alt="Sniksnak Chat Logo" 
              width={160}
              height={160}
              className="relative object-contain"
              priority
            />
          </div>
        </div>

        {/* Content */}
        <div className="space-y-6">
          <p className="text-sm text-gray-600 leading-relaxed">
            Parents sign up with email, then create child accounts using the child&apos;s real name and a PIN. Children can only use the app if a parent created their account (no anonymous/incognito names).
          </p>
          
          <div className="flex flex-col gap-3">
            <Link
              href="/login"
              className="block w-full py-3 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors shadow-md"
            >
              Parent login
            </Link>
            <Link
              href="/child-login"
              className="block w-full py-3 px-4 rounded-lg border-2 border-[#82DDC8] bg-white text-gray-700 font-medium hover:bg-[#C2EDD8] hover:border-[#82DDC8] focus:outline-none focus:ring-2 focus:ring-[#82DDC8] focus:ring-offset-2 transition-colors"
            >
              Child login
            </Link>
          </div>
          
          <p className="text-xs text-gray-400">
            Parents: sign up or log in with email. Children: log in with the name your parent set (your real name) and PIN.
          </p>
        </div>
      </div>
    </main>
  );
}
