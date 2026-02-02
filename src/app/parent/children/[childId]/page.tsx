"use client";

/**
 * Parent view: list of chats for a linked child.
 * Shows chats where the child is a participant; clicking a chat opens read-only chat detail.
 */
import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
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
        .select("id, surveillance_level")
        .eq("parent_id", uid)
        .eq("child_id", childId)
        .maybeSingle();

      if (linkErr || !linkData) {
        if (!cancelled) setError(linkErr?.message ?? "Not linked to this child");
        setLoading(false);
        return;
      }

      // Check surveillance level - only strict level parents can access
      const surveillanceLevel = linkData.surveillance_level as "strict" | "medium" | "mild" | null;
      if (surveillanceLevel !== "strict") {
        if (!cancelled) {
          if (surveillanceLevel === "medium") {
            setError("You have 'Medium' surveillance level. You can only access chats after receiving a keyword notification.");
          } else if (surveillanceLevel === "mild") {
            setError("You have 'Mild' surveillance level. You can only see chats when your child flags a message.");
          } else {
            setError("You don't have access to view this child's chats. Only 'Strict' surveillance level allows access.");
          }
        }
        setLoading(false);
        return;
      }

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
      <main className="min-h-screen flex items-center justify-center p-6" role="status">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  if (!user || error) {
    return (
      <main className="min-h-screen p-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-red-600" role="alert">{error ?? "Not found"}</p>
          <Link href="/parent" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
            ← Back to children list
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-semibold truncate">
            Chats for {childUser?.username ?? childUser?.email ?? childId}
          </h1>
          <Link
            href="/parent"
            className="text-sm text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            ← Back to children list
          </Link>
        </header>

        {chats.length === 0 ? (
          <section className="rounded-xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-500">No chats yet for this child.</p>
          </section>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white" role="list">
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
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 transition"
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
    </main>
  );
}
