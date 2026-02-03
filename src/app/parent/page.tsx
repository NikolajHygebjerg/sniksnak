"use client";

/**
 * Parent chat page: shows only parent-to-parent chats (chats between parents, not children).
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type Chat = {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
};

type UserRow = {
  id: string;
  email: string;
  username?: string | null;
  first_name?: string | null;
  surname?: string | null;
  avatar_url?: string | null;
};

function otherUserLabel(other: UserRow | undefined): string {
  if (!other) return "Unknown";
  if (other.first_name != null && other.surname != null && (other.first_name.trim() || other.surname.trim())) {
    const f = other.first_name.trim() || "?";
    const s = other.surname.trim() || "?";
    const cap = (x: string) => x.slice(0, 1).toUpperCase() + x.slice(1).toLowerCase();
    return `${cap(f)} ${cap(s)}`;
  }
  if (other.username?.trim()) return other.username.trim();
  return other.email ?? "Unknown";
}

type MessageRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
};

export default function ParentPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [usersById, setUsersById] = useState<Record<string, UserRow>>({});
  const [lastMessageByChat, setLastMessageByChat] = useState<Record<string, MessageRow>>({});
  const [lastReadByChat, setLastReadByChat] = useState<Record<string, string>>({});
  const [messagesFromOthers, setMessagesFromOthers] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<string | null>(null);
  const chatIdsRef = useRef<Set<string>>(new Set());

  const isActive = (path: string) => pathname === path;

  userRef.current = user?.id ?? null;
  chatIdsRef.current = new Set(chats.map((c) => c.id));

  // Realtime: new messages in any of our chats → update last message + unread
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("chats-list-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const row = payload.new as MessageRow;
          if (!chatIdsRef.current.has(row.chat_id)) return;
          setLastMessageByChat((prev) => ({ ...prev, [row.chat_id]: row }));
          if (row.sender_id !== userRef.current) {
            setMessagesFromOthers((prev) => [...prev, row]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

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

      // Check if user is a parent
      const { data: parentLinks } = await supabase
        .from("parent_child_links")
        .select("child_id, surveillance_level")
        .eq("parent_id", uid);

      // Get all chats where user is a direct participant
      const result = await supabase
        .from("chats")
        .select("id, user1_id, user2_id, created_at")
        .or(`user1_id.eq.${uid},user2_id.eq.${uid}`)
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (result.error) {
        setError(result.error.message);
        setLoading(false);
        return;
      }

      let list = (result.data ?? []) as Chat[];

      // Filter: only show parent-to-parent chats (exclude chats where either participant is a child)
      if (parentLinks && parentLinks.length > 0) {
        const childIds = new Set(parentLinks.map(link => link.child_id));
        list = list.filter((c) => {
          const user1IsChild = childIds.has(c.user1_id);
          const user2IsChild = childIds.has(c.user2_id);
          return !user1IsChild && !user2IsChild;
        });
      }

      if (!cancelled) {
        setChats(list);
      }

      if (list.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      const chatIds = list.map((c) => c.id);
      const otherIds = list.map((c) =>
        c.user1_id === uid ? c.user2_id : c.user1_id
      );
      const uniqueIds = [...new Set(otherIds)];

      const [usersRes, readsRes, messagesRes, othersRes] = await Promise.all([
        supabase.from("users").select("id, email, username, first_name, surname, avatar_url").in("id", uniqueIds).then((r) => {
          if (r.error && /username|first_name|surname|avatar_url|schema cache|column/i.test(r.error.message)) {
            return supabase.from("users").select("id, email, username, first_name, surname").in("id", uniqueIds);
          }
          return r;
        }),
        supabase
          .from("chat_reads")
          .select("chat_id, last_read_at")
          .eq("user_id", uid)
          .in("chat_id", chatIds),
        supabase
          .from("messages")
          .select("id, chat_id, sender_id, content, created_at")
          .in("chat_id", chatIds)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("messages")
          .select("id, chat_id, sender_id, content, created_at")
          .in("chat_id", chatIds)
          .neq("sender_id", uid),
      ]);

      if (cancelled) return;

      if (usersRes.data) {
        const map: Record<string, UserRow> = {};
        for (const u of usersRes.data) {
          map[u.id] = u;
        }
        if (!cancelled) setUsersById(map);
      }

      if (readsRes.data) {
        const byChat: Record<string, string> = {};
        for (const r of readsRes.data) {
          byChat[r.chat_id] = r.last_read_at;
        }
        if (!cancelled) setLastReadByChat(byChat);
      }

      if (messagesRes.data) {
        const byChat: Record<string, MessageRow> = {};
        for (const m of messagesRes.data as MessageRow[]) {
          if (!byChat[m.chat_id]) byChat[m.chat_id] = m;
        }
        if (!cancelled) setLastMessageByChat(byChat);
      }

      if (othersRes.data) {
        if (!cancelled) setMessagesFromOthers((othersRes.data ?? []) as MessageRow[]);
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function getUnreadCount(chatId: string): number {
    const lastRead = lastReadByChat[chatId];
    if (!lastRead) {
      return messagesFromOthers.filter((m) => m.chat_id === chatId).length;
    }
    return messagesFromOthers.filter(
      (m) => m.chat_id === chatId && m.created_at > lastRead
    ).length;
  }

  // Sort chats by last message timestamp (most recent first)
  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const lastMsgA = lastMessageByChat[a.id];
      const lastMsgB = lastMessageByChat[b.id];

      if (lastMsgA && lastMsgB) {
        return new Date(lastMsgB.created_at).getTime() - new Date(lastMsgA.created_at).getTime();
      }

      if (lastMsgA && !lastMsgB) return -1;
      if (!lastMsgA && lastMsgB) return 1;

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [chats, lastMessageByChat]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 sm:p-6" role="status" aria-label="Indlæser chats">
        <p className="text-gray-500">Indlæser…</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen flex flex-col safe-area-inset bg-[#C4E6CA] pb-20" style={{ fontFamily: 'Arial, sans-serif' }}>
      <div className="max-w-2xl mx-auto w-full flex flex-col min-h-0 px-4 py-6">
        {/* Logo */}
        <div className="flex-shrink-0 flex justify-center mb-4">
          <Image src="/logo.svg" alt="Sniksnak Chat" width={156} height={156} className="w-[156px] h-[156px]" />
        </div>

        {error && (
          <p className="mb-4 text-sm text-red-600" role="alert" style={{ fontFamily: 'Arial, sans-serif' }}>
            {error}
          </p>
        )}

        {/* Chat boks med runde hjørner og lysgrøn baggrund */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#E2F5E6] rounded-3xl overflow-hidden">
        {chats.length === 0 ? (
          <section
            className="rounded-3xl border border-gray-200 bg-[#E2F5E6] p-6 sm:p-8 text-center flex-1 flex flex-col items-center justify-center"
            aria-label="No chats"
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            <p className="text-lg font-medium text-gray-800 mb-2" style={{ fontFamily: 'Arial, sans-serif' }}>Ingen chats endnu</p>
            <p className="text-gray-500 mb-4 max-w-sm" style={{ fontFamily: 'Arial, sans-serif' }}>
              Dine chats med andre forældre vil vises her. Du modtager en chat, når et andet forældres barn vil forbinde med dit barn.
            </p>
          </section>
        ) : (
          <ul
            className="divide-y divide-gray-200 rounded-3xl border border-gray-200 bg-[#E2F5E6] flex-1 min-h-0 overflow-auto"
            role="list"
            aria-label="Chat list"
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            {sortedChats.map((chat) => {
              const otherId = chat.user1_id === user.id ? chat.user2_id : chat.user1_id;
              const other = usersById[otherId];
              const label = otherUserLabel(other);
              const lastMsg = lastMessageByChat[chat.id];
              const unread = getUnreadCount(chat.id);
              const date = lastMsg
                ? new Date(lastMsg.created_at)
                : new Date(chat.created_at);
              const dateStr =
                date.toDateString() === new Date().toDateString()
                  ? date.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : date.toLocaleDateString();
              const preview = lastMsg
                ? lastMsg.content?.trim() || "Vedhæftet fil"
                : "Ingen beskeder endnu";

              return (
                <li key={chat.id} role="listitem">
                  <Link
                    href={`/chats/${chat.id}`}
                    className="flex items-center gap-3 sm:gap-4 px-4 py-3 sm:py-3.5 hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#E0785B] transition touch-manipulation"
                    aria-label={`Chat with ${label}${unread > 0 ? `, ${unread} unread` : ""}`}
                  >
                    {other?.avatar_url ? (
                      <img
                        src={other.avatar_url}
                        alt={`${label}'s avatar`}
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
                      className={`h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium ${other?.avatar_url ? 'hidden' : ''}`}
                      aria-hidden="true"
                    >
                      {label.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 truncate" style={{ fontFamily: 'Arial, sans-serif' }}>
                          {label}
                        </span>
                        <span className="text-sm text-gray-500 flex-shrink-0" style={{ fontFamily: 'Arial, sans-serif' }}>
                          {dateStr}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 truncate mt-0.5" style={{ fontFamily: 'Arial, sans-serif' }}>
                        {preview}
                      </p>
                    </div>
                    {unread > 0 && (
                      <span
                        className="flex-shrink-0 rounded-full bg-[#E0785B] text-white text-xs font-medium min-w-[22px] h-[22px] inline-flex items-center justify-center px-1.5"
                        aria-label={`${unread} unread`}
                      >
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </div>

      {/* Bottom Navigation Bar for Parents */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom z-50">
        <div className="max-w-2xl mx-auto flex items-center justify-around px-2 py-2">
          <Link
            href="/parent"
            className={`flex flex-col items-center justify-center px-3 py-2 min-h-[60px] min-w-[60px] rounded-lg transition-colors ${
              isActive("/parent") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Chat"
          >
            <Image src="/chaticon.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
          <Link
            href="/parent/create-child"
            className={`flex flex-col items-center justify-center px-3 py-2 min-h-[60px] min-w-[60px] rounded-lg transition-colors ${
              isActive("/parent/create-child") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Opret barn"
          >
            <Image src="/parentcontrol.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
          <Link
            href="/parent/children"
            className={`flex flex-col items-center justify-center px-3 py-2 min-h-[60px] min-w-[60px] rounded-lg transition-colors ${
              isActive("/parent/children") ? "text-[#E0785B]" : "text-gray-400"
            }`}
            aria-label="Mine børn"
          >
            <Image src="/children.svg" alt="" width={48} height={48} className="w-12 h-12" />
          </Link>
          <Link
            href="/parent/settings"
            className={`flex flex-col items-center justify-center px-3 py-2 min-h-[60px] min-w-[60px] rounded-lg transition-colors ${
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
