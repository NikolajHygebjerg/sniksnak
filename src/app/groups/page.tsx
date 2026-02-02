"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type Group = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  avatar_url?: string | null;
  role: string;
  joined_at: string;
};

export default function GroupsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;

        if (!session?.user) {
          router.replace("/login");
          return;
        }

        setUser(session.user);

        // Verify user is a child
        const { data: ownUser } = await supabase
          .from("users")
          .select("username")
          .eq("id", session.user.id)
          .maybeSingle();

        if (cancelled) return;

        if (!ownUser?.username || ownUser.username.trim() === "") {
          // Not a child - redirect to parent view
          router.replace("/parent");
          return;
        }

        // Load groups
        const { data: { session: sessionForApi } } = await supabase.auth.getSession();
        if (!sessionForApi?.access_token) {
          setError("No session token");
          setLoading(false);
          return;
        }

        const res = await fetch("/api/groups/list", {
          headers: {
            Authorization: `Bearer ${sessionForApi.access_token}`,
          },
        });

        if (cancelled) return;

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          setError(errorData.error || "Failed to load groups");
          setLoading(false);
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        setGroups(data.groups || []);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("Error loading groups:", err);
        setError(err instanceof Error ? err.message : "An error occurred");
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 sm:p-6">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-red-600" role="alert">{error}</p>
          <Link href="/chats" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
            ← Back to chats
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 safe-area-inset">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold">Grupper</h1>
          <nav className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/chats"
              className="text-sm font-medium text-gray-600 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg px-2 py-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
            >
              Chats
            </Link>
            <Link
              href="/groups/new"
              className="text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg px-3 py-2 bg-blue-50 hover:bg-blue-100 min-h-[44px] inline-flex items-center justify-center"
            >
              + Opret gruppe
            </Link>
          </nav>
        </header>

        {groups.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-gray-600 mb-4">Du er ikke medlem af nogen grupper endnu.</p>
            <Link
              href="/groups/new"
              className="inline-block text-sm font-medium text-blue-600 hover:text-blue-700 bg-white px-4 py-2 rounded-lg border border-blue-200 hover:bg-blue-50 min-h-[44px] inline-flex items-center justify-center"
            >
              Opret din første gruppe
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="block rounded-xl border border-gray-200 bg-white p-4 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 transition touch-manipulation"
              >
                <div className="flex items-center gap-4">
                  {group.avatar_url ? (
                    <img
                      src={group.avatar_url}
                      alt=""
                      className="h-16 w-16 flex-shrink-0 rounded-full object-cover bg-gray-200"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const fallback = target.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <span
                    className={`h-16 w-16 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-lg font-medium ${group.avatar_url ? 'hidden' : ''}`}
                    aria-hidden="true"
                  >
                    {group.name[0]?.toUpperCase() || "G"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900 truncate">{group.name}</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      {group.role === "admin" ? "Admin" : "Medlem"}
                    </p>
                  </div>
                  <span className="text-gray-400 ml-4">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
