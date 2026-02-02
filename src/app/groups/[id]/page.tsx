"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
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

type GroupInvitation = {
  id: string;
  group_id: string;
  invited_by: string;
  invited_user_id: string;
  status: string;
  inviter: {
    id: string;
    first_name: string | null;
    surname: string | null;
    username: string | null;
  };
};

export default function GroupDetailPage() {
  const router = useRouter();
  const params = useParams();
  const groupId = params?.id as string | undefined;
  const [user, setUser] = useState<User | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<GroupInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitingFriendId, setInvitingFriendId] = useState<string | null>(null);
  const [acceptingInvitationId, setAcceptingInvitationId] = useState<string | null>(null);

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

        // Load group details
        const { data: { session: sessionForApi } } = await supabase.auth.getSession();
        if (!sessionForApi?.access_token) {
          setError("No session token");
          setLoading(false);
          return;
        }

        // Get group directly by ID
        const groupRes = await fetch(`/api/groups/${groupId}`, {
          headers: {
            Authorization: `Bearer ${sessionForApi.access_token}`,
          },
        });

        if (cancelled) return;

        if (!groupRes.ok) {
          const errorData = await groupRes.json().catch(() => ({}));
          setError(errorData.error || "Failed to load group");
          setLoading(false);
          return;
        }

        const groupData = await groupRes.json();
        const foundGroup = groupData.group as Group;

        if (!foundGroup) {
          setError("Group not found or you don't have access");
          setLoading(false);
          return;
        }

        setGroup(foundGroup);

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

        if (membersErr) {
          console.error("Error loading members:", membersErr);
        } else {
          setMembers((membersData || []) as GroupMember[]);
        }

        // Load pending invitations for this user
        const { data: invitationsData, error: invitationsErr } = await supabase
          .from("group_invitations")
          .select(`
            id,
            group_id,
            invited_by,
            invited_user_id,
            status,
            inviter:users!group_invitations_invited_by_fkey (
              id,
              first_name,
              surname,
              username
            )
          `)
          .eq("group_id", groupId)
          .eq("invited_user_id", session.user.id)
          .eq("status", "pending");

        if (cancelled) return;

        if (invitationsErr) {
          console.error("Error loading invitations:", invitationsErr);
        } else {
          setPendingInvitations((invitationsData || []) as GroupInvitation[]);
        }

        // Load friends (approved contacts) for inviting
        const { data: approvedRows } = await supabase
          .from("parent_approved_contacts")
          .select("contact_user_id")
          .eq("child_id", session.user.id);

        if (cancelled) return;

        if (approvedRows && approvedRows.length > 0) {
          const friendIds = approvedRows.map(r => r.contact_user_id).filter((id): id is string => !!id);
          
          // Get current member IDs to exclude
          const memberIds = members.map(m => m.user_id);
          const friendIdsToFetch = friendIds.filter(id => !memberIds.includes(id));

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
        console.error("Error loading group:", err);
        setError(err instanceof Error ? err.message : "An error occurred");
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [groupId, router, members.length]);

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

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to invite friend");
        setInvitingFriendId(null);
        return;
      }

      // Refresh page to show new invitation
      router.refresh();
      setShowInviteModal(false);
      setInvitingFriendId(null);
    } catch (err) {
      console.error("Error inviting friend:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setInvitingFriendId(null);
    }
  }

  async function handleAcceptInvitation(invitationId: string) {
    if (!user || acceptingInvitationId) return;

    setAcceptingInvitationId(invitationId);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("No session token");
        setAcceptingInvitationId(null);
        return;
      }

      const res = await fetch("/api/groups/accept-invitation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ invitationId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to accept invitation");
        setAcceptingInvitationId(null);
        return;
      }

      // Refresh page
      router.refresh();
      setAcceptingInvitationId(null);
    } catch (err) {
      console.error("Error accepting invitation:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setAcceptingInvitationId(null);
    }
  }

  function displayName(u: { first_name?: string | null; surname?: string | null; username?: string | null }): string {
    if (u.first_name && u.surname) {
      return `${u.first_name.trim()} ${u.surname.trim()}`;
    }
    return u.username?.trim() || "Unknown";
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 sm:p-6">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  if (error && !group) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-red-600" role="alert">{error}</p>
          <Link href="/groups" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
            ← Back to groups
          </Link>
        </div>
      </main>
    );
  }

  if (!group) return null;

  const isAdmin = group.role === "admin";

  return (
    <main className="min-h-screen p-4 sm:p-6 safe-area-inset">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center gap-4 mb-6">
          <Link
            href="/groups"
            className="text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center touch-manipulation"
            aria-label="Back to groups"
          >
            ← Grupper
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
          <h1 className="text-xl sm:text-2xl font-semibold">{group.name}</h1>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Pending invitations section */}
        {pendingInvitations.length > 0 && (
          <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Invitationer</h2>
            <div className="space-y-2">
              {pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between p-3 bg-white rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {displayName(invitation.inviter)} har inviteret dig til {group.name}
                    </p>
                  </div>
                  <button
                    onClick={() => handleAcceptInvitation(invitation.id)}
                    disabled={acceptingInvitationId === invitation.id}
                    className="ml-3 text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-3 py-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 min-h-[44px] inline-flex items-center justify-center"
                  >
                    {acceptingInvitationId === invitation.id ? "Accepterer…" : "Accepter"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Open chat button */}
        <div className="mb-6">
          <GroupChatButton groupId={groupId!} />
        </div>

        {/* Members section */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Medlemmer ({members.length})</h2>
            {isAdmin && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-3 py-1.5 min-h-[44px] inline-flex items-center justify-center"
              >
                + Inviter ven
              </button>
            )}
          </div>

          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50"
              >
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
            ))}
          </div>
        </section>

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
                className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
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
                      {friends.map((friend) => (
                        <button
                          key={friend.id}
                          onClick={() => handleInviteFriend(friend.id)}
                          disabled={invitingFriendId === friend.id}
                          className="w-full flex items-center gap-3 p-3 text-left rounded-xl hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
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
                          </div>
                          {invitingFriendId === friend.id ? (
                            <span className="text-sm text-gray-500">Inviterer…</span>
                          ) : (
                            <span className="text-sm text-blue-600">Inviter</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="p-4 border-t border-gray-200">
                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="w-full px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors min-h-[44px]"
                  >
                    Luk
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function GroupChatButton({ groupId }: { groupId: string }) {
  const [chatLoading, setChatLoading] = useState(false);

  async function handleOpenChat() {
    setChatLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return;
      }

      const res = await fetch("/api/groups/get-or-create-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ groupId }),
      });

      const data = await res.json();
      if (res.ok && data.chatId) {
        window.location.href = `/groups/${groupId}/chat`;
      }
    } catch (err) {
      console.error("Error opening chat:", err);
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <button
      onClick={handleOpenChat}
      disabled={chatLoading}
      className="block w-full rounded-xl border border-blue-300 bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition min-h-[44px] disabled:opacity-50"
    >
      {chatLoading ? "Åbner…" : "Åbn gruppe chat"}
    </button>
  );
}
