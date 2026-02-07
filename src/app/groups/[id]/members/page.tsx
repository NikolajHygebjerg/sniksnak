"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type Group = {
  id: string;
  name: string;
  created_by: string;
  avatar_url?: string | null;
};

type GroupMember = {
  id: string;
  user_id: string;
  role: string;
  user: {
    id: string;
    first_name: string | null;
    surname: string | null;
    username: string | null;
    avatar_url: string | null;
  };
};

type Friend = {
  id: string;
  first_name: string | null;
  surname: string | null;
  username: string | null;
  avatar_url: string | null;
};

export default function GroupMembersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const groupId = params?.id as string | undefined;
  const [user, setUser] = useState<User | null>(null);
  const [isChild, setIsChild] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [invitingFriendId, setInvitingFriendId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);

  function displayName(u: { first_name?: string | null; surname?: string | null; username?: string | null }): string {
    if (u.first_name && u.surname) {
      return `${u.first_name.trim()} ${u.surname.trim()}`;
    }
    return u.username?.trim() || "Unknown";
  }

  useEffect(() => {
    if (!groupId) return;
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

        // Check if user is a child
        const { data: userData } = await supabase
          .from("users")
          .select("is_child")
          .eq("id", session.user.id)
          .maybeSingle();
        
        if (!cancelled) {
          setIsChild(userData?.is_child ?? false);
        }

        // Load group details
        const { data: groupData } = await supabase
          .from("groups")
          .select("id, name, created_by, avatar_url")
          .eq("id", groupId)
          .maybeSingle();

        if (cancelled) return;

        if (!groupData) {
          setError("Gruppe ikke fundet");
          setLoading(false);
          return;
        }

        setGroup(groupData);

        // Load group members
        const { data: membersData, error: membersErr } = await supabase
          .from("group_members")
          .select(`
            id,
            user_id,
            role,
            user:users!group_members_user_id_fkey (
              id,
              first_name,
              surname,
              username,
              avatar_url
            )
          `)
          .eq("group_id", groupId)
          .order("joined_at", { ascending: true });

        if (cancelled) return;

        let processedMembers: GroupMember[] = [];
        if (membersErr) {
          console.error("Error loading members:", membersErr);
        } else {
          // Supabase returns nested relations as arrays, convert to single object
          processedMembers = (membersData || []).map((m: any) => ({
            ...m,
            user: Array.isArray(m.user) ? m.user[0] : m.user,
          })) as GroupMember[];
          setMembers(processedMembers);
        }

        // Check if current user is admin or creator (before loading friends)
        const currentUserMember = processedMembers.find(m => m.user_id === session.user.id);
        const userIsCreator = groupData.created_by === session.user.id;
        const userIsAdmin = currentUserMember?.role === "admin" || userIsCreator;
        setIsAdmin(userIsAdmin);
        setIsCreator(userIsCreator);

        // Load friends for inviting (only if admin)
        if (userIsAdmin) {
          // Get approved contacts (for children, use parent_approved_contacts)
          const { data: contactsData } = await supabase
            .from("parent_approved_contacts")
            .select("contact_user_id")
            .eq("child_id", session.user.id);

          if (cancelled) return;

          const friendIdsToFetch = (contactsData || [])
            .map(c => c.contact_user_id)
            .filter(id => !processedMembers.some(m => m.user_id === id)); // Exclude existing members

          if (friendIdsToFetch.length > 0) {
            const { data: friendsData } = await supabase
              .from("users")
              .select("id, first_name, surname, username, avatar_url")
              .in("id", friendIdsToFetch);

            if (cancelled) return;

            setFriends((friendsData || []) as Friend[]);
          }
        }

        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("Error loading group members:", err);
        setError(err instanceof Error ? err.message : "An error occurred");
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [groupId, router]);

  async function handleInviteFriend(friendId: string) {
    if (!user || !groupId || invitingFriendId) return;

    setInvitingFriendId(friendId);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("No session token");
        setInvitingFriendId(null);
        return;
      }

      const res = await fetch("/api/groups/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ groupId, friendId }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setError(errorData.error || "Failed to invite friend");
        setInvitingFriendId(null);
        return;
      }

      // Reload members
      const { data: membersData } = await supabase
        .from("group_members")
        .select(`
          id,
          user_id,
          role,
          user:users!group_members_user_id_fkey (
            id,
            first_name,
            surname,
            username,
            avatar_url
          )
        `)
        .eq("group_id", groupId)
        .order("joined_at", { ascending: true });

      if (membersData) {
        const processedMembers = (membersData || []).map((m: any) => ({
          ...m,
          user: Array.isArray(m.user) ? m.user[0] : m.user,
        })) as GroupMember[];
        setMembers(processedMembers);
        
        // Update admin and creator status
        if (user && group) {
          const currentUserMember = processedMembers.find(m => m.user_id === user.id);
          const userIsCreator = group.created_by === user.id;
          setIsAdmin(currentUserMember?.role === "admin" || userIsCreator);
          setIsCreator(userIsCreator);
        }
      }

      setInvitingFriendId(null);
      setShowInviteModal(false);
    } catch (err) {
      console.error("Error inviting friend:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setInvitingFriendId(null);
    }
  }

  async function handleRemoveMember(memberId: string, userId: string) {
    if (!user || !groupId || removingMemberId) return;

    if (userId === user.id) {
      setError("Du kan ikke fjerne dig selv");
      return;
    }

    setRemovingMemberId(memberId);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("No session token");
        setRemovingMemberId(null);
        return;
      }

      const res = await fetch("/api/groups/remove-member", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ groupId, userId }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setError(errorData.error || "Failed to remove member");
        setRemovingMemberId(null);
        return;
      }

      // Remove from local state
      setMembers(prev => prev.filter(m => m.id !== memberId));
      setRemovingMemberId(null);
    } catch (err) {
      console.error("Error removing member:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setRemovingMemberId(null);
    }
  }

  async function handleDeleteGroup() {
    if (!user || !groupId || deletingGroup) return;

    setDeletingGroup(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("No session token");
        setDeletingGroup(false);
        return;
      }

      const res = await fetch("/api/groups/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ groupId }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setError(errorData.error || "Failed to delete group");
        setDeletingGroup(false);
        return;
      }

      // Redirect to groups page after successful deletion
      router.push("/groups");
    } catch (err) {
      console.error("Error deleting group:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setDeletingGroup(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 sm:p-6">
        <p className="text-gray-500">Indlæser…</p>
      </main>
    );
  }

  if (error && !group) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-red-600" role="alert">{error}</p>
          <Link href="/groups" className="mt-4 inline-block text-sm text-[#E0785B] hover:underline">
            ← Tilbage til grupper
          </Link>
        </div>
      </main>
    );
  }

  if (!group) return null;

  return (
    <main className="min-h-screen p-4 sm:p-6 safe-area-inset bg-[#C4E6CA] pb-20">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center gap-4 mb-6">
          <Link
            href={`/groups/${groupId}/chat`}
            className="text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#E0785B] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center touch-manipulation"
            aria-label="Tilbage til chat"
          >
            ← Chat
          </Link>
          {group.avatar_url ? (
            <img
              src={group.avatar_url}
              alt=""
              className="h-12 w-12 flex-shrink-0 rounded-full object-cover bg-gray-200"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const fallback = target.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = 'flex';
              }}
            />
          ) : null}
          <span
            className={`h-12 w-12 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-lg font-medium ${group.avatar_url ? 'hidden' : ''}`}
            aria-hidden="true"
          >
            {group.name[0]?.toUpperCase() || "G"}
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold truncate" style={{ fontFamily: 'Arial, sans-serif' }}>{group.name}</h1>
            <p className="text-sm text-gray-500">Medlemmer</p>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Members section */}
        <section className="rounded-xl border border-gray-200 bg-[#E2F5E6] p-4 sm:p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Medlemmer ({members.length})</h2>
            {isAdmin && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="text-sm font-medium text-[#E0785B] hover:text-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B] rounded px-3 py-1.5 bg-white hover:bg-[#E2F5E6] min-h-[44px] inline-flex items-center justify-center"
              >
                + Inviter ven
              </button>
            )}
          </div>

          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 p-3 bg-white rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {member.user.avatar_url ? (
                    <img
                      src={member.user.avatar_url}
                      alt=""
                      className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-gray-200"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const fallback = target.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <span
                    className={`h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium ${member.user.avatar_url ? 'hidden' : ''}`}
                    aria-hidden="true"
                  >
                    {displayName(member.user)[0]?.toUpperCase() || "?"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {displayName(member.user)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {member.role === "admin" ? "Admin" : "Medlem"}
                    </p>
                  </div>
                </div>
                {isAdmin && member.user_id !== user?.id && (
                  <button
                    onClick={() => handleRemoveMember(member.id, member.user_id)}
                    disabled={removingMemberId === member.id}
                    className="text-sm font-medium text-red-600 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-3 py-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-50 min-h-[44px] inline-flex items-center justify-center"
                  >
                    {removingMemberId === member.id ? "Fjerner…" : "Fjern"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Delete group section (only for creator) */}
        {isCreator && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4 sm:p-6 mb-6">
            <h2 className="text-sm font-semibold text-red-800 mb-2">Farlig zone</h2>
            <p className="text-sm text-red-700 mb-4">
              Sletning af gruppen kan ikke fortrydes. Alle medlemmer, beskeder og invitationer vil blive slettet permanent.
            </p>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-4 py-2 min-h-[44px] inline-flex items-center justify-center"
            >
              Slet gruppe
            </button>
          </section>
        )}

        {/* Delete confirmation modal */}
        {showDeleteConfirm && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setShowDeleteConfirm(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div
                className="bg-[#E2F5E6] rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Bekræft sletning</h3>
                </div>
                <div className="p-4">
                  <p className="text-sm text-gray-700 mb-4">
                    Er du sikker på, at du vil slette gruppen <strong>{group.name}</strong>? Denne handling kan ikke fortrydes.
                  </p>
                  <p className="text-xs text-gray-500 mb-4">
                    Alle medlemmer, beskeder og invitationer vil blive slettet permanent.
                  </p>
                </div>
                <div className="p-4 border-t border-gray-200 flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deletingGroup}
                    className="flex-1 px-4 py-2 text-center font-medium text-gray-700 hover:bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors min-h-[44px] disabled:opacity-50"
                  >
                    Annuller
                  </button>
                  <button
                    onClick={handleDeleteGroup}
                    disabled={deletingGroup}
                    className="flex-1 px-4 py-2 text-center font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors min-h-[44px] disabled:opacity-50"
                  >
                    {deletingGroup ? "Sletter…" : "Slet gruppe"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Invite modal */}
        {showInviteModal && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setShowInviteModal(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div
                className="bg-[#E2F5E6] rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Inviter ven til gruppe</h3>
                </div>
                <div className="p-4 max-h-[60vh] overflow-y-auto">
                  {friends.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">
                      Du har ingen venner at invitere.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {friends.map((friend) => {
                        const isAlreadyMember = members.some(m => m.user_id === friend.id);
                        return (
                          <button
                            key={friend.id}
                            onClick={() => !isAlreadyMember && handleInviteFriend(friend.id)}
                            disabled={invitingFriendId === friend.id || isAlreadyMember}
                            className="w-full flex items-center gap-3 p-3 text-left rounded-lg hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#E0785B] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {friend.avatar_url ? (
                              <img
                                src={friend.avatar_url}
                                alt=""
                                className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-gray-200"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  const fallback = target.nextElementSibling as HTMLElement;
                                  if (fallback) fallback.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <span
                              className={`h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium ${friend.avatar_url ? 'hidden' : ''}`}
                              aria-hidden="true"
                            >
                              {displayName(friend)[0]?.toUpperCase() || "?"}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {displayName(friend)}
                              </p>
                              {isAlreadyMember && (
                                <p className="text-xs text-gray-500">Allerede medlem</p>
                              )}
                            </div>
                            {invitingFriendId === friend.id && (
                              <span className="text-sm text-gray-500">Inviterer…</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="p-4 border-t border-gray-200">
                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="w-full px-4 py-2 text-center font-medium text-gray-700 hover:bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E0785B] transition-colors min-h-[44px]"
                  >
                    Luk
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom Navigation Bar - Only for children */}
      {isChild && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom z-50">
          <div className="max-w-2xl mx-auto flex items-center justify-around px-2 py-1">
            <Link
              href="/chats"
              className="flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors text-gray-400"
              aria-label="Chat"
            >
              <Image src="/chaticon.svg" alt="" width={48} height={48} className="w-12 h-12" />
            </Link>
            <Link
              href="/groups"
              className="flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors text-[#E0785B]"
              aria-label="Grupper"
            >
              <Image src="/groupsicon.svg" alt="" width={67} height={67} className="w-[67px] h-[67px]" />
            </Link>
            <Link
              href="/chats/new"
              className="flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors text-gray-400"
              aria-label="Find venner"
            >
              <Image src="/findfriends.svg" alt="" width={48} height={48} className="w-12 h-12" />
            </Link>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                router.push("/");
                router.refresh();
              }}
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
