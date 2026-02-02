"use client";

/**
 * Guards all /parent/* routes: children cannot access (redirected to /chats).
 * Parents go straight to the dashboard; no code required.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ParentGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        if (!cancelled) router.replace("/login");
        return;
      }
      const uid = session.user.id;

      const { data: ownUser } = await supabase
        .from("users")
        .select("username")
        .eq("id", uid)
        .single();

      if (!cancelled && ownUser?.username != null && String(ownUser.username).trim() !== "") {
        router.replace("/chats");
        return;
      }

      if (!cancelled) setAllowed(true);
    }

    check();
  }, [router]);

  if (allowed === null) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" role="status" aria-label="Loading">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  return <>{children}</>;
}
