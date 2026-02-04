"use client";

/**
 * Parent children overview page: list of linked children from parent_child_links.
 * Parents see children they are linked to; clicking a child goes to that child's chat list.
 */
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type LinkRow = {
  id: number;
  parent_id: string;
  child_id: string;
  surveillance_level?: string | null;
};

type UserRow = {
  id: string;
  email: string;
  username?: string | null;
  first_name?: string | null;
  surname?: string | null;
  avatar_url?: string | null;
};

export default function ParentChildrenPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [usersById, setUsersById] = useState<Record<string, UserRow>>({});
  const [friendsByChildId, setFriendsByChildId] = useState<Record<string, UserRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);
  const [updatingSurveillanceLevel, setUpdatingSurveillanceLevel] = useState<string | null>(null);
  const [sendingLogin, setSendingLogin] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<Array<{
    id: number;
    child_id: string;
    contact_user_id: string;
    chat_id: string;
    created_at: string;
  }>>([]);
  const [contactUsersById, setContactUsersById] = useState<Record<string, UserRow>>({});
  const [processingRequestId, setProcessingRequestId] = useState<number | null>(null);

  const isActive = (path: string) => pathname === path;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  async function handleUpdateSurveillanceLevel(childId: string, newLevel: "strict" | "medium" | "mild") {
    if (!user || updatingSurveillanceLevel) return;
    
    setUpdatingSurveillanceLevel(childId);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setUpdatingSurveillanceLevel(null);
      return;
    }
    
    try {
      const res = await fetch("/api/parent/update-surveillance-level", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ childId, surveillanceLevel: newLevel }),
      });
      
      const data = await res.json();
      if (!res.ok) {
        console.error("Error updating surveillance level:", data.error, data.details);
        setError(`Kunne ikke opdatere overvågningsniveau: ${data.error}${data.details ? ` (${data.details})` : ""}`);
        setUpdatingSurveillanceLevel(null);
        return;
      }
      
      // Update local state
      setLinks((prev) =>
        prev.map((link) =>
          link.child_id === childId ? { ...link, surveillance_level: newLevel } : link
        )
      );
      setUpdatingSurveillanceLevel(null);
    } catch (err) {
      console.error("Exception updating surveillance level:", err);
      setError(err instanceof Error ? err.message : "Der opstod en fejl");
      setUpdatingSurveillanceLevel(null);
    }
  }

  async function handleSendLogin(childId: string, childName: string) {
    if (!user || sendingLogin) return;
    
    setSendingLogin(childId);
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setSendingLogin(null);
      setError("Session udløbet. Log venligst ind igen.");
      return;
    }
    
    try {
      const res = await fetch("/api/parent/send-child-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ childId }),
      });
      
      const data = await res.json();
      if (!res.ok) {
        setError(`Kunne ikke sende loginoplysninger: ${data.error}`);
        setSendingLogin(null);
        return;
      }
      
      setError(null);
      alert(`Loginoplysninger for ${childName} er sendt til din email.`);
      setSendingLogin(null);
    } catch (err) {
      console.error("Exception sending login:", err);
      setError(err instanceof Error ? err.message : "Der opstod en fejl");
      setSendingLogin(null);
    }
  }

  async function handleAcceptRequest(requestId: number, childId: string, contactUserId: string) {
    if (!user || processingRequestId !== null) return;
    
    setProcessingRequestId(requestId);
    setError(null);
    
    try {
      // Add to approved contacts
      const { error: approveErr } = await supabase
        .from("parent_approved_contacts")
        .insert({
          child_id: childId,
          contact_user_id: contactUserId,
          parent_id: user.id,
        });

      if (approveErr && approveErr.code !== "23505") {
        // 23505 = already exists, which is fine
        setError(`Kunne ikke acceptere anmodning: ${approveErr.message}`);
        setProcessingRequestId(null);
        return;
      }

      // Delete from pending requests
      const { error: deleteErr } = await supabase
        .from("pending_contact_requests")
        .delete()
        .eq("id", requestId);

      if (deleteErr) {
        setError(`Kunne ikke fjerne anmodning: ${deleteErr.message}`);
        setProcessingRequestId(null);
        return;
      }

      // Refresh the page to show updated data
      setRefreshKey((prev) => prev + 1);
      setProcessingRequestId(null);
    } catch (err) {
      console.error("Exception accepting request:", err);
      setError(err instanceof Error ? err.message : "Der opstod en fejl");
      setProcessingRequestId(null);
    }
  }

  async function handleRejectRequest(requestId: number) {
    if (!user || processingRequestId !== null) return;
    
    setProcessingRequestId(requestId);
    setError(null);
    
    try {
      // Delete from pending requests
      const { error: deleteErr } = await supabase
        .from("pending_contact_requests")
        .delete()
        .eq("id", requestId);

      if (deleteErr) {
        setError(`Kunne ikke afvise anmodning: ${deleteErr.message}`);
        setProcessingRequestId(null);
        return;
      }

      // Refresh the page to show updated data
      setRefreshKey((prev) => prev + 1);
      setProcessingRequestId(null);
    } catch (err) {
      console.error("Exception rejecting request:", err);
      setError(err instanceof Error ? err.message : "Der opstod en fejl");
      setProcessingRequestId(null);
    }
  }

  async function handleDeleteChild(childId: string, childName: string) {
    if (!user) return;
    if (!confirm(`Er du sikker på, at du vil slette kontoen for ${childName}? Dette vil fjerne din forbindelse til dette barn, men deres konto forbliver.`)) {
      return;
    }
    setDeletingChildId(childId);
    setError(null);

    const linkToDelete = links.find((l) => l.child_id === childId);
    if (!linkToDelete) {
      setDeletingChildId(null);
      setError("Link ikke fundet");
      return;
    }

    const { error: deleteErr } = await supabase
      .from("parent_child_links")
      .delete()
      .eq("id", linkToDelete.id)
      .eq("parent_id", user.id);

    setDeletingChildId(null);
    if (deleteErr) {
      setError(deleteErr.message);
      return;
    }

    setLinks((prev) => prev.filter((l) => l.id !== linkToDelete.id));
    setUsersById((prev) => {
      const updated = { ...prev };
      delete updated[childId];
      return updated;
    });
    setFriendsByChildId((prev) => {
      const updated = { ...prev };
      delete updated[childId];
      return updated;
    });
  }

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

      const { data: linksData, error: linksErr } = await supabase
        .from("parent_child_links")
        .select("id, parent_id, child_id, surveillance_level")
        .eq("parent_id", uid);

      if (cancelled) return;

      if (linksErr) {
        setError(linksErr.message);
        setLoading(false);
        return;
      }

      const linksList = (linksData ?? []) as LinkRow[];
      if (!cancelled) setLinks(linksList);

      if (linksList.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      const childIds = linksList.map((l) => l.child_id);
      const { data: usersData, error: usersErr } = await supabase
        .from("users")
        .select("id, email, username, first_name, surname, avatar_url")
        .in("id", childIds);

      if (cancelled) return;

      if (usersErr) {
        setError(usersErr.message);
        setLoading(false);
        return;
      }

      if (!cancelled && usersData) {
        const map: Record<string, UserRow> = {};
        for (const u of usersData) {
          map[u.id] = u;
        }
        setUsersById(map);
      }

      // Load friends (approved contacts) for each child
      if (!cancelled && childIds.length > 0) {
        try {
          const { data: approvedRows } = await supabase
            .from("parent_approved_contacts")
            .select("child_id, contact_user_id")
            .in("child_id", childIds);

          if (cancelled) return;

          if (approvedRows) {
            const friendIdsByChild: Record<string, string[]> = {};
            for (const row of approvedRows as { child_id: string; contact_user_id: string }[]) {
              if (!friendIdsByChild[row.child_id]) friendIdsByChild[row.child_id] = [];
              friendIdsByChild[row.child_id].push(row.contact_user_id);
            }

            const allFriendIds = [...new Set(Object.values(friendIdsByChild).flat())].filter((id): id is string => !!id && typeof id === "string");
            if (allFriendIds.length > 0) {
              const friendsRes = await supabase
                .from("users")
                .select("id, email, username, first_name, surname, avatar_url")
                .in("id", allFriendIds);

              if (cancelled) return;

              if (friendsRes.data) {
                const friendsMap: Record<string, UserRow[]> = {};
                for (const childId of childIds) {
                  const friendIds = friendIdsByChild[childId] || [];
                  friendsMap[childId] = (friendsRes.data as UserRow[]).filter((f) => friendIds.includes(f.id));
                }
                setFriendsByChildId(friendsMap);
              }
            }
          }
        } catch (err) {
          console.error("Exception loading friends:", err);
        }
      }

      // Load pending contact requests
      if (!cancelled && childIds.length > 0) {
        try {
          const { data: pendingData, error: pendingErr } = await supabase
            .from("pending_contact_requests")
            .select("id, child_id, contact_user_id, chat_id, created_at")
            .in("child_id", childIds);

          if (cancelled) return;

          if (pendingErr) {
            console.error("Error loading pending requests:", pendingErr);
          } else if (pendingData) {
            setPendingRequests(pendingData as Array<{
              id: number;
              child_id: string;
              contact_user_id: string;
              chat_id: string;
              created_at: string;
            }>);

            // Load contact user info
            const contactIds = [...new Set(pendingData.map((r: any) => r.contact_user_id))];
            if (contactIds.length > 0) {
              const { data: contactUsersData } = await supabase
                .from("users")
                .select("id, email, username, first_name, surname, avatar_url")
                .in("id", contactIds);

              if (contactUsersData && !cancelled) {
                const contactMap: Record<string, UserRow> = {};
                for (const u of contactUsersData) {
                  contactMap[u.id] = u;
                }
                setContactUsersById(contactMap);
              }
            }
          }
        } catch (err) {
          console.error("Exception loading pending requests:", err);
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router, refreshKey]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" role="status" aria-label="Loading">
        <p className="text-gray-500">Indlæser…</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen p-6 bg-[#C4E6CA] pb-20">
      <div className="max-w-2xl mx-auto">
        {/* Logo */}
        <div className="flex-shrink-0 flex justify-center mb-4">
          <Image src="/logo.svg" alt="Sniksnak Chat" width={156} height={156} className="w-[156px] h-[156px]" />
        </div>

        <h1 className="text-2xl font-semibold mb-4" style={{ fontFamily: 'Arial, sans-serif' }}>Mine børn</h1>
        <p className="text-gray-500 text-sm mb-4" style={{ fontFamily: 'Arial, sans-serif' }}>
          Her kan du se de børn du har oprettet. Du kan se deres venner. Har du sat overvågning til streng kan du tilgå barnets chats.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Pending contact requests section */}
        {pendingRequests.length > 0 && (
          <section className="mb-6 rounded-3xl border border-gray-200 bg-[#E2F5E6] p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: 'Arial, sans-serif' }}>Venneanmodninger</h2>
            <div className="space-y-3">
              {pendingRequests.map((request) => {
                const child = usersById[request.child_id];
                const contact = contactUsersById[request.contact_user_id];
                const childLabel = child?.first_name && child?.surname
                  ? `${child.first_name} ${child.surname}`
                  : child?.username ?? child?.email ?? "Dit barn";
                const contactLabel = contact?.first_name && contact?.surname
                  ? `${contact.first_name} ${contact.surname}`
                  : contact?.username ?? contact?.email ?? "Nogen";
                
                return (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900" style={{ fontFamily: 'Arial, sans-serif' }}>
                        <span className="font-semibold">{contactLabel}</span> vil gerne chatte med <span className="font-semibold">{childLabel}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRejectRequest(request.id)}
                        disabled={processingRequestId === request.id}
                        className="px-4 py-2 text-sm font-semibold text-red-700 bg-white border-2 border-red-300 rounded-lg hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        style={{ fontFamily: 'Arial, sans-serif' }}
                      >
                        {processingRequestId === request.id ? "Afviser…" : "Afvis"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAcceptRequest(request.id, request.child_id, request.contact_user_id)}
                        disabled={processingRequestId === request.id}
                        className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-md"
                        style={{ fontFamily: 'Arial, sans-serif' }}
                      >
                        {processingRequestId === request.id ? "Accepterer…" : "Acceptér"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {links.length === 0 ? (
          <section className="rounded-3xl border border-gray-200 bg-[#E2F5E6] p-8 text-center">
            <p className="text-gray-500 mb-2">Ingen børn endnu.</p>
            <p className="text-sm text-gray-400">
              Opret en børnekonto på "Opret barn" siden.
            </p>
          </section>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-3xl border border-gray-200 bg-[#E2F5E6]" role="list">
            {links.map((link) => {
              const child = usersById[link.child_id];
              const label =
                child?.first_name && child?.surname
                  ? `${child.first_name} ${child.surname}`
                  : child?.username ?? child?.email ?? link.child_id;
              const friends = friendsByChildId[link.child_id] || [];
              const friendLabel = (f: UserRow) =>
                f.first_name && f.surname ? `${f.first_name} ${f.surname}` : f.username ?? f.email ?? "Unknown";
              const rawLevel = link.surveillance_level as "strict" | "medium" | "mild" | null | undefined;
              const surveillanceLevel: "strict" | "medium" | "mild" = (rawLevel === "strict" || rawLevel === "medium" || rawLevel === "mild") ? rawLevel : "medium";
              const canViewChats = surveillanceLevel === "strict";

              return (
                <li key={link.id} role="listitem" className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {canViewChats ? (
                      <Link
                        href={`/parent/children/${link.child_id}`}
                        className="flex items-center gap-3 min-w-0 flex-1 hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#E0785B] transition rounded-lg -mx-2 px-2"
                        aria-label={`Se chats for ${label}`}
                      >
                        {child?.avatar_url ? (
                          <img
                            src={child.avatar_url}
                            alt=""
                            className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-gray-200"
                          />
                        ) : (
                          <span className="h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium" aria-hidden>
                            {label.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">{label}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              surveillanceLevel === "strict" ? "bg-red-100 text-red-700" :
                              surveillanceLevel === "medium" ? "bg-yellow-100 text-yellow-700" :
                              surveillanceLevel === "mild" ? "bg-green-100 text-green-700" :
                              "bg-gray-100 text-gray-700"
                            }`}>
                              {surveillanceLevel === "strict" ? "Streng" :
                               surveillanceLevel === "medium" ? "Medium" :
                               surveillanceLevel === "mild" ? "Mild" : "Ukendt"}
                            </span>
                          </div>
                        </div>
                        <span className="text-sm text-gray-500 flex-shrink-0 ml-auto">Se chats →</span>
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {child?.avatar_url ? (
                          <img
                            src={child.avatar_url}
                            alt=""
                            className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-gray-200"
                          />
                        ) : (
                          <span className="h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium" aria-hidden>
                            {label.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">{label}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              surveillanceLevel === "strict" ? "bg-red-100 text-red-700" :
                              surveillanceLevel === "medium" ? "bg-yellow-100 text-yellow-700" :
                              surveillanceLevel === "mild" ? "bg-green-100 text-green-700" :
                              "bg-gray-100 text-gray-700"
                            }`}>
                              {surveillanceLevel === "strict" ? "Streng" :
                               surveillanceLevel === "medium" ? "Medium" :
                               surveillanceLevel === "mild" ? "Mild" : "Ukendt"}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {surveillanceLevel === "strict"
                              ? "Fuld adgang til chats og billeder"
                              : surveillanceLevel === "medium"
                              ? "Adgang kun efter nøgleordsnotifikation"
                              : surveillanceLevel === "mild"
                              ? "Adgang kun når barnet flagger en besked"
                              : "Ukendt overvågningsniveau"}
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <select
                        value={surveillanceLevel}
                        onChange={(e) => {
                          const newLevel = e.target.value as "strict" | "medium" | "mild";
                          handleUpdateSurveillanceLevel(link.child_id, newLevel);
                        }}
                        disabled={updatingSurveillanceLevel === link.child_id}
                        className="text-xs rounded-lg border border-gray-300 bg-white px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#E0785B] disabled:opacity-50"
                        aria-label={`Skift overvågningsniveau for ${label}`}
                      >
                        <option value="strict">Streng</option>
                        <option value="medium">Medium</option>
                        <option value="mild">Mild</option>
                      </select>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSendLogin(link.child_id, label);
                        }}
                        disabled={sendingLogin === link.child_id}
                        className="flex-shrink-0 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`Send loginoplysninger for ${label}`}
                        title={`Send loginoplysninger for ${label} til din email`}
                      >
                        {sendingLogin === link.child_id ? "Sender…" : "Send login"}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDeleteChild(link.child_id, label);
                        }}
                        disabled={deletingChildId === link.child_id}
                        className="flex-shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`Slet konto for ${label}`}
                        title={`Slet konto for ${label}`}
                      >
                        {deletingChildId === link.child_id ? "Sletter…" : "Slet konto"}
                      </button>
                    </div>
                  </div>
                  {friends.length > 0 && (
                    <div className="mt-2 ml-[52px]">
                      <p className="text-xs text-gray-500 mb-1.5">Venner ({friends.length}):</p>
                      <div className="flex flex-wrap gap-1.5">
                        {friends.map((friend) => (
                          <div
                            key={friend.id}
                            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1"
                          >
                            {friend.avatar_url ? (
                              <img src={friend.avatar_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                            ) : (
                              <span className="h-4 w-4 rounded-full bg-gray-300 flex items-center justify-center text-[10px] font-medium text-gray-600">
                                {friendLabel(friend).slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span className="text-xs font-medium text-gray-700">{friendLabel(friend)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Bottom Navigation Bar for Parents */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom z-50">
        <div className="max-w-2xl mx-auto flex items-center justify-around px-2 py-1">
          <Link
            href="/parent"
            className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
              isActive("/parent") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Chat"
          >
            <Image src="/chaticon.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
          <Link
            href="/parent/create-child"
            className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
              isActive("/parent/create-child") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Opret barn"
          >
            <Image src="/parentcontrol.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
          <Link
            href="/parent/children"
            className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
              isActive("/parent/children") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Mine børn"
          >
            <Image src="/children.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
          <Link
            href="/parent/settings"
            className={`flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
              isActive("/parent/settings") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Indstillinger"
          >
            <Image src="/Settings.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
        </div>
      </nav>
    </main>
  );
}
