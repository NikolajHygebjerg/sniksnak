"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type UserRow = {
  id: string;
  email: string;
  username?: string | null;
  first_name?: string | null;
  surname?: string | null;
  avatar_url?: string | null;
};

/** Display name for a user (child: First Surname; else username or email) */
function displayName(u: UserRow): string {
  if (u.first_name != null && u.surname != null && (u.first_name.trim() || u.surname.trim())) {
    const f = u.first_name.trim() || "?";
    const s = u.surname.trim() || "?";
    const cap = (x: string) => x.slice(0, 1).toUpperCase() + x.slice(1).toLowerCase();
    return `${cap(f)} ${cap(s)}`;
  }
  if (u.username?.trim()) return u.username.trim();
  return u.email ?? "Unknown";
}

export default function NewChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [otherUsers, setOtherUsers] = useState<UserRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [hasOtherChildren, setHasOtherChildren] = useState<boolean | null>(null);

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return []; // Don't show any users until they search
    const q = searchQuery.trim().toLowerCase();
    const filtered = otherUsers.filter((u) => {
      const name = displayName(u).toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      const username = (u.username ?? "").toLowerCase();
      const first = (u.first_name ?? "").toLowerCase();
      const last = (u.surname ?? "").toLowerCase();
      return (
        name.includes(q) ||
        email.includes(q) ||
        username.includes(q) ||
        first.includes(q) ||
        last.includes(q)
      );
    });
    return filtered;
  }, [otherUsers, searchQuery]);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace("/login");
        return;
      }
      setUser(session.user);
      const uid = session.user.id;

      // Only load children (is_child = true) who have an active parent link
      // First, get all children with parent links
      const { data: linksData, error: linksErr } = await supabase
        .from("parent_child_links")
        .select("child_id");
      
      if (linksErr) {
        console.error("Error loading parent_child_links:", linksErr);
        setError(linksErr.message);
        setLoading(false);
        return;
      }
      
      const activeChildIds = new Set((linksData ?? []).map((l: { child_id: string }) => l.child_id));
      
      if (activeChildIds.size === 0) {
        setOtherUsers([]);
        setHasOtherChildren(false);
        setLoading(false);
        return;
      }

      // Only load children who have an active parent link (exclude current user)
      const childIdsArray = Array.from(activeChildIds).filter((id) => id !== uid);
      
      if (childIdsArray.length === 0) {
        setOtherUsers([]);
        setHasOtherChildren(false);
        setLoading(false);
        return;
      }
      
      setHasOtherChildren(true);

      // Query users table: filter by is_child = true and active parent links
      // Try with is_child column first, fall back to username check if column doesn't exist
      let usersRes = await supabase
        .from("users")
        .select("id, email, username, first_name, surname, avatar_url")
        .eq("is_child", true)
        .in("id", childIdsArray)
        .order("username", { nullsFirst: false });
      
      // Error handling: if is_child column doesn't exist, fall back to username check
      if (usersRes.error) {
        const errorMsg = usersRes.error.message || "";
        const errorCode = usersRes.error.code || "";
        const isColumnError = /is_child|column.*does not exist|schema cache|42703/i.test(errorMsg) || errorCode === "42703";
        
        if (isColumnError) {
          // Fallback: use username check (old method) - query without is_child filter
          usersRes = await supabase
            .from("users")
            .select("id, email, username, first_name, surname, avatar_url")
            .not("username", "is", null)
            .in("id", childIdsArray)
            .order("username", { nullsFirst: false });
          
          if (usersRes.error) {
            const fallbackError = usersRes.error.message || "";
            // Try without avatar_url if that's the issue
            if (/avatar_url|schema cache|column/i.test(fallbackError)) {
              const fallbackRes = await supabase
                .from("users")
                .select("id, email, username, first_name, surname")
                .not("username", "is", null)
                .in("id", childIdsArray)
                .order("email");
              // Add avatar_url to match expected type
              if (fallbackRes.data) {
                usersRes = {
                  ...fallbackRes,
                  data: fallbackRes.data.map((u: any) => ({ ...u, avatar_url: null as string | null })),
                } as any as typeof usersRes;
              } else {
                usersRes = fallbackRes;
              }
            }
          }
        } else if (/avatar_url|schema cache|column/i.test(errorMsg)) {
          // avatar_url column issue - retry without it
          const fallbackRes = await supabase
            .from("users")
            .select("id, email, username, first_name, surname")
            .eq("is_child", true)
            .in("id", childIdsArray)
            .order("email");
          if (fallbackRes.data) {
            usersRes = {
              ...fallbackRes,
              data: fallbackRes.data.map((u: any) => ({ ...u, avatar_url: null })),
            } as any as typeof usersRes;
          } else {
            usersRes = {
              ...fallbackRes,
              data: [],
            } as any as typeof usersRes;
          }
        }
      }
      
      const { data: usersData, error: usersErr } = usersRes;

      if (usersErr) {
        console.error("Error loading users:", usersErr);
        setError(usersErr.message);
        setHasOtherChildren(false);
      } else {
        // Filter to ensure we only have children (double-check with is_child if available)
        // IMPORTANT: Only show children that have an active parent link AND are in the childIdsArray
        // Add avatar_url if missing from query result
        const usersWithAvatar = (usersData ?? []).map((u: any) => ({
          ...u,
          avatar_url: u.avatar_url ?? null,
        })) as UserRow[];
        
        const childrenOnly = usersWithAvatar.filter((u: UserRow) => {
          // Must be in the childIdsArray (has active parent link)
          const hasActiveLink = childIdsArray.includes(u.id);
          // If is_child column exists in response, use it; otherwise fall back to username check
          const hasUsername = u.username != null && String(u.username).trim() !== "";
          return hasActiveLink && hasUsername; // Both conditions must be true
        });
        setOtherUsers(childrenOnly);
        setHasOtherChildren(childrenOnly.length > 0);
      }
      setLoading(false);
    }
    load();
  }, [router]);

  async function startChat(otherId: string) {
    if (!user) return;
    setCreating(otherId);
    setError(null);
    const [id1, id2] = [user.id, otherId].sort();
    const { data: existing } = await supabase
      .from("chats")
      .select("id")
      .eq("user1_id", id1)
      .eq("user2_id", id2)
      .maybeSingle();

    if (existing?.id) {
      router.push(`/chats/${existing.id}`);
      return;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("chats")
      .insert({ user1_id: id1, user2_id: id2 })
      .select("id")
      .single();

    setCreating(null);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    if (inserted?.id) {
      const otherUserId = otherId;
      const { data: otherUserRow } = await supabase.from("users").select("username").eq("id", otherUserId).maybeSingle();
      const isChild = otherUserRow?.username != null && String(otherUserRow.username).trim() !== "";
      if (isChild) {
        // Get session once for both API calls
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.access_token) {
          // Insert pending contact request (or update if it already exists)
          // This notifies the parent that someone wants to chat with their child
          // Use API route to bypass RLS issues with direct client-side upsert
          try {
            const res = await fetch("/api/pending-request/create", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({
                child_id: otherUserId,
                contact_user_id: user.id,
                chat_id: inserted.id,
              }),
            });
            
            if (!res.ok) {
              const errorData = await res.json().catch(() => ({}));
              console.error("Error creating pending contact request via API:", {
                status: res.status,
                error: errorData.error || res.statusText,
                details: errorData
              });
            } else {
              console.log("Successfully created pending contact request via API");
            }
          } catch (apiErr) {
            // Safe error logging
            try {
              if (apiErr && typeof apiErr === "object" && Object.keys(apiErr).length > 0) {
                console.error("Exception calling pending request API:", apiErr);
              } else {
                console.error("Unknown error occurred:", apiErr);
              }
            } catch (logErr) {
              console.error("Error occurred but could not be logged:", String(apiErr || "Unknown"));
            }
            // Don't block navigation - the chat is created, just the notification might fail
          }
          
          // Also create parent-to-parent chat invitation
          // This creates a chat between the two parents so they can discuss the friend request
          fetch("/api/invitation/create-parent-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ invited_child_id: otherUserId }),
          })
          .then(async (res) => {
            if (!res.ok) {
              const errorData = await res.json().catch(() => ({}));
              console.error("Error creating parent chat invitation:", {
                status: res.status,
                error: errorData.error || res.statusText,
                details: errorData
              });
            } else {
              const data = await res.json().catch(() => ({}));
              console.log("Successfully created parent chat invitation:", data);
            }
          })
          .catch((err) => {
            // Safe error logging
            try {
              if (err && typeof err === "object" && Object.keys(err).length > 0) {
                console.error("Exception creating parent chat invitation:", err);
              } else {
                console.error("Unknown error occurred:", err);
              }
            } catch (logErr) {
              console.error("Error occurred but could not be logged:", String(err || "Unknown"));
            }
          });
        } else {
          console.warn("No session token available - cannot create pending contact request or parent chat invitation");
        }
      }
      router.push(`/chats/${inserted.id}`);
    }
  }

  if (loading || !user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  function copyAppLink() {
    const url = typeof window !== "undefined" ? window.location.origin : "";
    navigator.clipboard.writeText(url);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Find Chat-friends</h1>
          <Link
            href="/chats"
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back to chats
          </Link>
        </div>
        <p className="text-gray-500 text-sm mb-4">
          Search for other children by name, or send them an invite link so they can join and chat with you.
        </p>

        {error && (
          <p className="mb-4 text-sm text-red-600">{error}</p>
        )}

        <div className="mb-4">
          <label htmlFor="search-chat-friends" className="sr-only">
            Search for children by name
          </label>
          <input
            id="search-chat-friends"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for children by first name or surname…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoComplete="off"
          />
        </div>

        {!searchQuery.trim() ? null : hasOtherChildren === false ? (
          <section className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
            <p className="text-gray-600 mb-2">No other children found</p>
            <p className="text-sm text-gray-500 mb-4">
              There are no other children with active accounts in the system yet. Share the app link below so other children can join and connect with you.
            </p>
            <button
              type="button"
              onClick={copyAppLink}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {inviteCopied ? "Copied!" : "Copy app link to invite"}
            </button>
          </section>
        ) : filteredUsers.length === 0 ? (
          <section className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
            <p className="text-gray-600 mb-2">No matches for &quot;{searchQuery}&quot;</p>
            <p className="text-sm text-gray-500 mb-4">
              Try a different name, or send the app link to a friend so they can join.
            </p>
            <button
              type="button"
              onClick={copyAppLink}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {inviteCopied ? "Copied!" : "Copy app link to invite"}
            </button>
          </section>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
            {filteredUsers.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => startChat(u.id)}
                  disabled={creating === u.id}
                  className="flex w-full items-center gap-3 justify-between px-4 py-3 text-left hover:bg-gray-50 transition disabled:opacity-50"
                >
                  <span className="flex items-center gap-3 min-w-0 flex-1">
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-gray-200" />
                    ) : (
                      <span className="h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium" aria-hidden>
                        {displayName(u).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="font-medium text-gray-900 truncate">{displayName(u)}</span>
                  </span>
                  {creating === u.id ? (
                    <span className="text-sm text-gray-500">Sending…</span>
                  ) : (
                    <span className="text-sm text-blue-600">Be friend</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-700 mb-1">Invite a friend</p>
          <p className="text-sm text-gray-500 mb-3">
            Can&apos;t find someone? Share the app link so they can join. Then search for their name to send them a friend request.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={typeof window !== "undefined" ? window.location.origin : ""}
              className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
            />
            <button
              type="button"
              onClick={copyAppLink}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {inviteCopied ? "Copied!" : "Copy link"}
            </button>
          </div>
        </section>

        <p className="mt-6">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">
            ← Home
          </Link>
        </p>
      </div>
    </main>
  );
}
