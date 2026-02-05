"use client";

/**
 * Parent view: list of chats for a linked child.
 * Shows chats where the child is a participant; clicking a chat opens read-only chat detail.
 */
import { useEffect, useState, useRef } from "react";
import { useRouter, useParams, usePathname } from "next/navigation";
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
};

type MessageRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
};

export default function ParentChildChatsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const childId = params?.childId as string | undefined;
  const [user, setUser] = useState<User | null>(null);
  const [childUser, setChildUser] = useState<UserRow | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [usersById, setUsersById] = useState<Record<string, UserRow>>({});
  const [lastMessageByChat, setLastMessageByChat] = useState<Record<string, MessageRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chatIdsRef = useRef<Set<string>>(new Set());

  const isActive = (path: string) => pathname === path;

  useEffect(() => {
    if (!childId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace("/login");
        return;
      }
      setUser(session.user);
      const uid = session.user.id;

      // Verify current user is a parent of this child with strict surveillance level
      const { data: linkData, error: linkErr } = await supabase
        .from("parent_child_links")
        .select("id")
        .eq("parent_id", uid)
        .eq("child_id", childId)
        .maybeSingle();

      if (linkErr || !linkData) {
        if (!cancelled) setError(linkErr?.message ?? "Not linked to this child");
        setLoading(false);
        return;
      }

      // All parents can access (surveillance level check removed)

      let childRes = await supabase.from("users").select("id, email, username").eq("id", childId).single();
      if (childRes.error && /username|schema cache/i.test(childRes.error.message)) {
        childRes = await supabase.from("users").select("id, email").eq("id", childId).single();
      }
      const { data: childData } = childRes;

      if (!cancelled && childData) setChildUser(childData as UserRow);

      // Chats where this child is a participant (parent can read via RLS)
      const { data: chatsData, error: chatsErr } = await supabase
        .from("chats")
        .select("id, user1_id, user2_id, created_at")
        .or(`user1_id.eq.${childId},user2_id.eq.${childId}`)
        .order("created_at", { ascending: false });

      if (chatsErr) {
        if (!cancelled) setError(chatsErr.message);
        setLoading(false);
        return;
      }

      const list = (chatsData ?? []) as Chat[];
      if (!cancelled) setChats(list);
      chatIdsRef.current = new Set(list.map((c) => c.id));

      if (list.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      const chatIds = list.map((c) => c.id);
      const otherIds = list.map((c) =>
        c.user1_id === childId ? c.user2_id : c.user1_id
      );
      const uniqueIds = [...new Set(otherIds)];

      const usersQuery = supabase.from("users").select("id, email, username").in("id", uniqueIds);
      const [usersRes, messagesRes] = await Promise.all([
        usersQuery.then((r) => {
          if (r.error && /username|schema cache/i.test(r.error.message)) {
            return supabase.from("users").select("id, email").in("id", uniqueIds);
          }
          return r;
        }),
        supabase
          .from("messages")
          .select("id, chat_id, sender_id, content, created_at")
          .in("chat_id", chatIds)
          .order("created_at", { ascending: false }),
      ]);

      if (!cancelled && usersRes.data) {
        const map: Record<string, UserRow> = {};
        for (const u of usersRes.data as UserRow[]) {
          map[u.id] = u;
        }
        setUsersById(map);
      }

      if (!cancelled && messagesRes.data) {
        const byChat: Record<string, MessageRow> = {};
        for (const m of messagesRes.data as MessageRow[]) {
          if (!byChat[m.chat_id]) byChat[m.chat_id] = m;
        }
        setLastMessageByChat(byChat);
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [childId, router]);

  // Realtime: new messages in any of this child's chats
  useEffect(() => {
    if (!childId || !user) return;
    const channel = supabase
      .channel(`parent-child-chats-${childId}`)
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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [childId, user?.id]);

  if (loading || !childId) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-[#C4E6CA]" role="status">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  if (!user || error) {
    return (
      <main className="min-h-screen p-6 bg-[#C4E6CA]">
        <div className="max-w-2xl mx-auto">
          <p className="text-red-600" role="alert">{error ?? "Ikke fundet"}</p>
          <Link href="/parent" className="mt-4 inline-block text-sm text-[#E0785B] hover:underline">
            ← Tilbage til børneliste
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 bg-[#C4E6CA] pb-20">
      <div className="max-w-2xl mx-auto">
        {/* Logo */}
        <div className="flex-shrink-0 flex justify-center mb-4">
          <Image src="/logo.svg" alt="Sniksnak Chat" width={156} height={156} className="w-[156px] h-[156px]" loading="eager" />
        </div>

        <header className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl font-semibold truncate" style={{ fontFamily: 'Arial, sans-serif' }}>
            Chats for {childUser?.username ?? childUser?.email ?? childId}
          </h1>
          <Link
            href="/parent"
            className="text-sm text-[#E0785B] hover:underline focus:outline-none focus:ring-2 focus:ring-[#E0785B] rounded"
          >
            ← Tilbage til børneliste
          </Link>
        </header>

        {chats.length === 0 ? (
          <section className="rounded-xl border border-gray-200 bg-[#E2F5E6] p-8 text-center">
            <p className="text-gray-500">No chats yet for this child.</p>
          </section>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-[#E2F5E6]" role="list">
            {chats.map((chat) => {
              const otherId = chat.user1_id === childId ? chat.user2_id : chat.user1_id;
              const other = usersById[otherId];
              const label = other?.username ?? other?.email ?? "Unknown";
              const lastMsg = lastMessageByChat[chat.id];
              const date = lastMsg
                ? new Date(lastMsg.created_at)
                : new Date(chat.created_at);
              const dateStr =
                date.toDateString() === new Date().toDateString()
                  ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : date.toLocaleDateString();
              const preview = lastMsg
                ? lastMsg.content?.trim() || "Attachment"
                : "No messages yet";

              return (
                <li key={chat.id} role="listitem">
                  <Link
                    href={`/parent/children/${childId}/chats/${chat.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#E0785B] transition"
                    aria-label={`View chat with ${label}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 truncate">{label}</span>
                        <span className="text-sm text-gray-500 flex-shrink-0">{dateStr}</span>
                      </div>
                      <p className="text-sm text-gray-500 truncate mt-0.5">{preview}</p>
                    </div>
                    <span className="text-sm text-gray-400">View →</span>
                  </Link>
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
