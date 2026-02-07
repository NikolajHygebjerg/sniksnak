"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import UnreadBadge from "@/components/UnreadBadge";

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
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isChild, setIsChild] = useState(false);

  const isActive = (path: string) => pathname === path;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

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

        const isChildUser = !!(ownUser?.username != null && String(ownUser.username).trim() !== "");
        if (!isChildUser) {
          // Not a child - redirect to parent view
          router.replace("/parent");
          return;
        }
        if (!cancelled) {
          setIsChild(true);
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

        if (data.error) {
          console.error("Error from groups/list API:", data.error);
          setError(data.error || "Failed to load groups");
          setLoading(false);
          return;
        }

        const groupsList: Group[] = data.groups || [];
        console.log("Loaded groups:", groupsList.length, groupsList.map(g => ({ id: g.id, name: g.name, created_by: g.created_by })));
        setGroups(groupsList);
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
        <p className="text-gray-500">Indlæser…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-red-600" role="alert">{error}</p>
          <Link href="/chats" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
            ← Tilbage til chats
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 safe-area-inset bg-[#C4E6CA] pb-20">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl font-semibold" style={{ fontFamily: 'Arial, sans-serif' }}>Grupper</h1>
          <Link
            href="/groups/new"
            className="text-sm font-medium text-[#E0785B] hover:text-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 rounded-lg px-3 py-2 bg-[#E2F5E6] hover:bg-white min-h-[44px] inline-flex items-center justify-center"
          >
            + Opret gruppe
          </Link>
        </header>

        {groups.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-[#E2F5E6] p-8 text-center">
            <p className="text-gray-600 mb-4">Du er ikke medlem af nogen grupper endnu.</p>
            <Link
              href="/groups/new"
              className="inline-block text-sm font-medium text-[#E0785B] hover:text-[#D06A4F] bg-white px-4 py-2 rounded-lg border border-[#E0785B] hover:bg-[#E2F5E6] min-h-[44px] inline-flex items-center justify-center"
            >
              Opret din første gruppe
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}/chat`}
                className="block rounded-xl border border-gray-200 bg-[#E2F5E6] p-4 hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#E0785B] transition touch-manipulation"
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

      {/* Bottom Navigation Bar - Only for children */}
      {isChild && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom z-50">
          <div className="max-w-2xl mx-auto flex items-center justify-around px-2 py-1">
            <Link
              href="/chats"
              className={`relative flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
                isActive("/chats") ? "text-[#E0785B]" : "text-gray-400"
              }`}
              aria-label="Chat"
            >
              <Image src="/chaticon.svg" alt="" width={48} height={48} className="w-12 h-12" />
              <UnreadBadge userId={user?.id ?? null} />
            </Link>
            <Link
              href="/groups"
              className={`relative flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
                isActive("/groups") ? "text-[#E0785B]" : "text-gray-400"
              }`}
              aria-label="Grupper"
            >
              <Image src="/groupsicon.svg" alt="" width={67} height={67} className="w-[67px] h-[67px]" />
              <UnreadBadge userId={user?.id ?? null} />
            </Link>
            <Link
              href="/chats/new"
              className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
                isActive("/chats/new") ? "text-[#E0785B]" : "text-gray-400"
              }`}
              aria-label="Find venner"
            >
              <Image src="/findfriends.svg" alt="" width={48} height={48} className="w-12 h-12" />
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors text-gray-400 hover:text-[#E0785B] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
              aria-label="Indstillinger"
            >
              <Image src="/logout.svg" alt="" width={48} height={48} className="w-12 h-12" />
            </button>
          </div>
        </nav>
      )}
    </main>
  );
}
