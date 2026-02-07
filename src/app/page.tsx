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
      <main className="min-h-screen flex items-center justify-center p-6 bg-[#C4E6CA]">
        <div className="flex flex-col items-center space-y-4">
          <Image 
            src="/logo.svg" 
            alt="Sniksnak Chat Logo" 
            width={120}
            height={120}
            className="w-[120px] h-[120px]"
            priority
            loading="eager"
          />
          <p className="text-gray-500">Indlæser…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#C4E6CA]">
      <div className="w-full max-w-sm flex flex-col items-center space-y-12">
        {/* Logo */}
        <div className="flex flex-col items-center">
          <Image 
            src="/logo.svg" 
            alt="Sniksnak Chat Logo" 
            width={156}
            height={156}
            className="w-[156px] h-[156px]"
            priority
            loading="eager"
          />
        </div>

        {/* Buttons */}
        <div className="w-full flex flex-col gap-4">
          <Link
            href="/login"
            className="block w-full py-4 px-6 rounded-lg bg-[#E0785B] text-white text-base font-medium hover:bg-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 transition-colors text-center"
          >
            Forælder login
          </Link>
          <Link
            href="/child-login"
            className="block w-full py-4 px-6 rounded-lg border-2 border-[#E0785B] bg-white text-[#E0785B] text-base font-medium hover:bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 transition-colors text-center"
          >
            Barn login
          </Link>
        </div>
        
        {/* Help text */}
        <p className="text-xs text-gray-500 text-center leading-relaxed max-w-xs">
          Forældre: tilmeld dig eller log ind med email. Børn: log ind med det navn din forælder har sat (dit rigtige navn) og PIN.
        </p>
      </div>
    </main>
  );
}
