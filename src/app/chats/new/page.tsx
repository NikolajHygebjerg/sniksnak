"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import UnreadBadge from "@/components/UnreadBadge";

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
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [otherUsers, setOtherUsers] = useState<UserRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [hasOtherChildren, setHasOtherChildren] = useState<boolean | null>(null);
  const [isChild, setIsChild] = useState(false);
  const [sentRequests, setSentRequests] = useState<Array<{
    id: number;
    child_id: string;
    contact_user_id: string;
    chat_id: string;
    created_at: string;
  }>>([]);
  const [requestChildrenById, setRequestChildrenById] = useState<Record<string, UserRow>>({});
  const [withdrawingRequestId, setWithdrawingRequestId] = useState<number | null>(null);

  const isActive = (path: string) => pathname === path;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

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
    let cancelled = false;
    
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace("/login");
        return;
      }
      setUser(session.user);
      const uid = session.user.id;

      // Check if current user is a child
      const { data: userData } = await supabase
        .from("users")
        .select("is_child, username")
        .eq("id", uid)
        .maybeSingle();
      
      // Check if user is a child - either has is_child=true OR has a username
      const userIsChild = userData?.is_child === true || (userData?.username != null && String(userData.username).trim() !== "");
      setIsChild(userIsChild);

      // Only load children (is_child = true) who have an active parent link
      // First, get all children with parent links
      const { data: linksData, error: linksErr } = await supabase
        .from("parent_child_links")
        .select("child_id");
      
      if (cancelled) return;
      
      if (linksErr) {
        console.error("Error loading parent_child_links:", linksErr);
        if (!cancelled) {
          setError(linksErr.message);
          setLoading(false);
        }
        return;
      }
      
      if (cancelled) return;
      
      const activeChildIds = new Set((linksData ?? []).map((l: { child_id: string }) => l.child_id));
      
      if (activeChildIds.size === 0) {
        if (!cancelled) {
          setOtherUsers([]);
          setHasOtherChildren(false);
          setLoading(false);
        }
        return;
      }

      // Only load children who have an active parent link (exclude current user)
      const childIdsArray = Array.from(activeChildIds).filter((id) => id !== uid);
      
      if (cancelled) return;
      
      if (childIdsArray.length === 0) {
        if (!cancelled) {
          setOtherUsers([]);
          setHasOtherChildren(false);
          setLoading(false);
        }
        return;
      }
      
      if (!cancelled) {
        setHasOtherChildren(true);
      }

      if (cancelled) return;

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
      
      if (cancelled) return;
      
      const { data: usersData, error: usersErr } = usersRes;

      if (usersErr) {
        console.error("Error loading users:", usersErr);
        if (!cancelled) {
          setError(usersErr.message);
          setHasOtherChildren(false);
        }
      } else {
        // Filter to ensure we only have children (double-check with is_child if available)
        // IMPORTANT: Only show children that have an active parent link AND are in the childIdsArray
        // Add avatar_url if missing from query result
        const usersWithAvatar = (usersData ?? []).map((u: any) => ({
          ...u,
          avatar_url: u.avatar_url ?? null,
        })) as UserRow[];
        
        if (cancelled) return;
        
        const childrenOnly = usersWithAvatar.filter((u: UserRow) => {
          // Must be in the childIdsArray (has active parent link)
          const hasActiveLink = childIdsArray.includes(u.id);
          // If is_child column exists in response, use it; otherwise fall back to username check
          const hasUsername = u.username != null && String(u.username).trim() !== "";
          return hasActiveLink && hasUsername; // Both conditions must be true
        });
        
        if (!cancelled) {
          setOtherUsers(childrenOnly);
          setHasOtherChildren(childrenOnly.length > 0);
        }
      }

      // Load sent pending requests if user is a child
      if (userIsChild) {
        console.log("[Find friends] Loading sent requests for user:", uid);
        const { data: sentRequestsData, error: sentRequestsErr } = await supabase
          .from("pending_contact_requests")
          .select("id, child_id, contact_user_id, chat_id, created_at")
          .eq("contact_user_id", uid);

        if (cancelled) return;

        if (sentRequestsErr) {
          console.error("[Find friends] Error loading sent requests:", sentRequestsErr);
          // Don't set error state - this is not critical
        } else {
          console.log("[Find friends] Sent requests loaded:", sentRequestsData?.length || 0);
          if (sentRequestsData && sentRequestsData.length > 0) {
            if (!cancelled) {
              setSentRequests(sentRequestsData as Array<{
                id: number;
                child_id: string;
                contact_user_id: string;
                chat_id: string;
                created_at: string;
              }>);
            }

            // Load child info for sent requests
            const childIds = [...new Set(sentRequestsData.map((r: any) => r.child_id))];
            if (childIds.length > 0 && !cancelled) {
              const { data: childrenData, error: childrenErr } = await supabase
                .from("users")
                .select("id, email, username, first_name, surname, avatar_url")
                .in("id", childIds);

              if (cancelled) return;

              if (childrenErr) {
                console.error("[Find friends] Error loading children for sent requests:", childrenErr);
              } else if (childrenData && !cancelled) {
                const childrenMap: Record<string, UserRow> = {};
                for (const c of childrenData) {
                  childrenMap[c.id] = c;
                }
                setRequestChildrenById(childrenMap);
              }
            }
          } else if (!cancelled) {
            // Explicitly set empty array if no requests found
            setSentRequests([]);
          }
        }
      } else {
        console.log("[Find friends] User is not a child, skipping sent requests load");
      }

      if (!cancelled) {
        setLoading(false);
      }
    }
    load();
    
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleWithdrawRequest(requestId: number) {
    if (!user || withdrawingRequestId !== null) return;
    
    setWithdrawingRequestId(requestId);
    setError(null);
    
    try {
      const { error: deleteErr } = await supabase
        .from("pending_contact_requests")
        .delete()
        .eq("id", requestId)
        .eq("contact_user_id", user.id); // Ensure user can only delete their own requests

      if (deleteErr) {
        setError(`Kunne ikke trække anmodning tilbage: ${deleteErr.message}`);
        setWithdrawingRequestId(null);
        return;
      }

      // Remove from local state
      setSentRequests((prev) => prev.filter((r) => r.id !== requestId));
      setWithdrawingRequestId(null);
    } catch (err) {
      console.error("Exception withdrawing request:", err);
      setError(err instanceof Error ? err.message : "Der opstod en fejl");
      setWithdrawingRequestId(null);
    }
  }

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
      
      // Refresh sent requests after creating a new one
      if (isChild) {
        const { data: updatedRequests } = await supabase
          .from("pending_contact_requests")
          .select("id, child_id, contact_user_id, chat_id, created_at")
          .eq("contact_user_id", user.id);
        
        if (updatedRequests) {
          setSentRequests(updatedRequests as Array<{
            id: number;
            child_id: string;
            contact_user_id: string;
            chat_id: string;
            created_at: string;
          }>);
          
          // Also update children map
          const childIds = [...new Set(updatedRequests.map((r: any) => r.child_id))];
          if (childIds.length > 0) {
            const { data: childrenData } = await supabase
              .from("users")
              .select("id, email, username, first_name, surname, avatar_url")
              .in("id", childIds);
            
            if (childrenData) {
              const childrenMap: Record<string, UserRow> = {};
              for (const c of childrenData) {
                childrenMap[c.id] = c;
              }
              setRequestChildrenById(childrenMap);
            }
          }
        }
      }
    }
  }

  if (loading || !user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-500">Indlæser…</p>
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
    <main className="min-h-screen p-6 bg-[#C4E6CA] pb-20">
      <div className="max-w-2xl mx-auto">
        {/* Logo */}
        <div className="flex-shrink-0 flex justify-center mb-4">
          <Image src="/logo.svg" alt="Sniksnak Chat" width={156} height={156} className="w-[156px] h-[156px]" />
        </div>
        <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: 'Arial, sans-serif' }}>Find chat-venner</h1>
        <p className="text-gray-500 text-sm mb-6" style={{ fontFamily: 'Arial, sans-serif' }}>
          Søg efter andre børn efter navn, eller send dem et invitationslink, så de kan deltage og chatte med dig.
        </p>

        {error && (
          <p className="mb-4 text-sm text-red-600" style={{ fontFamily: 'Arial, sans-serif' }}>{error}</p>
        )}

        {/* Search field - main focus */}
        <div className="mb-6">
          <label htmlFor="search-chat-friends" className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Arial, sans-serif' }}>
            Søg efter børn
          </label>
          <input
            id="search-chat-friends"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Indtast fornavn eller efternavn…"
            className="w-full rounded-xl border-2 border-gray-300 bg-[#E2F5E6] px-4 py-3 text-base focus:border-[#E0785B] focus:outline-none focus:ring-2 focus:ring-[#E0785B] transition"
            style={{ fontFamily: 'Arial, sans-serif' }}
            autoComplete="off"
          />
        </div>

        {/* Sent friend requests section - moved below search */}
        {isChild && (
          <section className="mb-6 rounded-3xl border border-gray-200 bg-[#E2F5E6] p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: 'Arial, sans-serif' }}>Sendte venneanmodninger</h2>
            {sentRequests.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-2" style={{ fontFamily: 'Arial, sans-serif' }}>
                Du har ikke sendt nogen venneanmodninger endnu.
              </p>
            ) : (
              <div className="space-y-3">
                {sentRequests.map((request) => {
                  const child = requestChildrenById[request.child_id];
                  const childLabel = child?.first_name && child?.surname
                    ? `${child.first_name} ${child.surname}`
                    : child?.username ?? child?.email ?? "Ukendt";
                  
                  return (
                    <div
                      key={request.id}
                      className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900" style={{ fontFamily: 'Arial, sans-serif' }}>
                          Ventende på godkendelse fra <span className="font-semibold">{childLabel}</span>s forælder
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleWithdrawRequest(request.id)}
                        disabled={withdrawingRequestId === request.id}
                        className="ml-3 px-4 py-2 text-sm font-semibold text-red-700 bg-white border-2 border-red-300 rounded-lg hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition flex-shrink-0"
                        style={{ fontFamily: 'Arial, sans-serif' }}
                      >
                        {withdrawingRequestId === request.id ? "Trækker tilbage…" : "Træk tilbage"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {!searchQuery.trim() ? null : hasOtherChildren === false ? (
          <section className="rounded-xl border border-gray-200 bg-[#E2F5E6] p-6 text-center">
            <p className="text-gray-600 mb-2">Ingen andre børn fundet</p>
            <p className="text-sm text-gray-500 mb-4">
              Der er ingen andre børn med aktive konti i systemet endnu. Del app-linket nedenfor, så andre børn kan deltage og forbinde med dig.
            </p>
            <button
              type="button"
              onClick={copyAppLink}
              className="rounded-lg bg-[#E0785B] px-4 py-2 text-sm font-medium text-white hover:bg-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
            >
              {inviteCopied ? "Kopieret!" : "Kopiér app-link for at invitere"}
            </button>
          </section>
        ) : filteredUsers.length === 0 ? (
          <section className="rounded-xl border border-gray-200 bg-[#E2F5E6] p-6 text-center">
            <p className="text-gray-600 mb-2">Ingen resultater for &quot;{searchQuery}&quot;</p>
            <p className="text-sm text-gray-500 mb-4">
              Prøv et andet navn, eller send app-linket til en ven, så de kan deltage.
            </p>
            <button
              type="button"
              onClick={copyAppLink}
              className="rounded-lg bg-[#E0785B] px-4 py-2 text-sm font-medium text-white hover:bg-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
            >
              {inviteCopied ? "Kopieret!" : "Kopiér app-link for at invitere"}
            </button>
          </section>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-[#E2F5E6]">
            {filteredUsers.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => startChat(u.id)}
                  disabled={creating === u.id}
                  className="flex w-full items-center gap-3 justify-between px-4 py-3 text-left hover:bg-white transition disabled:opacity-50"
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
                    <span className="text-sm text-gray-500">Sender…</span>
                  ) : (
                    <span className="text-sm text-[#E0785B]">Bliv ven</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-6 rounded-xl border border-gray-200 bg-[#E2F5E6] p-4">
          <p className="text-sm font-medium text-gray-700 mb-1" style={{ fontFamily: 'Arial, sans-serif' }}>Inviter en ven</p>
          <p className="text-sm text-gray-500 mb-3" style={{ fontFamily: 'Arial, sans-serif' }}>
            Kan du ikke finde nogen? Del app-linket, så de kan deltage. Søg derefter efter deres navn for at sende dem en venneanmodning.
          </p>
          <button
            type="button"
            onClick={copyAppLink}
            className="w-full rounded-lg bg-[#E0785B] px-4 py-2 text-sm font-medium text-white hover:bg-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B] min-h-[44px]"
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            {inviteCopied ? "Kopieret!" : "Kopiér invitation"}
          </button>
        </section>
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
              className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
                isActive("/groups") ? "text-[#E0785B]" : "text-gray-400"
              }`}
              aria-label="Grupper"
            >
              <Image src="/groupsicon.svg" alt="" width={67} height={67} className="w-[67px] h-[67px]" />
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
