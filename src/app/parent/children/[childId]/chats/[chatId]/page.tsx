"use client";

/**
 * Parent view: read-only chat detail for a linked child's chat.
 * Shows messages with realtime updates; each message has a Flag button.
 * Flagged messages are visually indicated for parents/admins.
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
};

type UserRow = {
  id: string;
  email: string;
};

type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
};

type FlagRow = {
  id: number;
  message_id: string;
  flagged_by: string;
  reason: string | null;
  created_at: string;
};

export default function ParentChatDetailPage() {
  const router = useRouter();
  const params = useParams();
  const childId = params?.childId as string | undefined;
  const chatId = params?.chatId as string | undefined;
  const [user, setUser] = useState<User | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [childUser, setChildUser] = useState<UserRow | null>(null);
  const [otherUser, setOtherUser] = useState<UserRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [flagsByMessageId, setFlagsByMessageId] = useState<Record<string, FlagRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flaggingMessageId, setFlaggingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chatId || !childId) {
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

      const { data: chatData, error: chatErr } = await supabase
        .from("chats")
        .select("id, user1_id, user2_id")
        .eq("id", chatId)
        .maybeSingle();

      if (chatErr || !chatData) {
        if (!cancelled) setError(chatErr?.message ?? "Chat not found");
        setLoading(false);
        return;
      }

      const c = chatData as Chat;
      if (c.user1_id !== childId && c.user2_id !== childId) {
        if (!cancelled) setError("This chat does not belong to this child");
        setLoading(false);
        return;
      }

      if (!cancelled) setChat(c);

      const otherId = c.user1_id === childId ? c.user2_id : c.user1_id;
      const [childRes, otherRes, messagesRes] = await Promise.all([
        supabase.from("users").select("id, email").eq("id", childId).single(),
        supabase.from("users").select("id, email").eq("id", otherId).single(),
        supabase
          .from("messages")
          .select("id, chat_id, sender_id, content, created_at, attachment_url, attachment_type")
          .eq("chat_id", chatId)
          .order("created_at", { ascending: true }),
      ]);

      if (!cancelled && childRes.data) setChildUser(childRes.data as UserRow);
      if (!cancelled && otherRes.data) setOtherUser(otherRes.data as UserRow);
      if (!cancelled && messagesRes.data) setMessages((messagesRes.data ?? []) as Message[]);

      if (!cancelled && messagesRes.data) {
        const messageIds = (messagesRes.data as Message[]).map((m) => m.id);
        if (messageIds.length > 0) {
          const { data: flagsData } = await supabase
            .from("flags")
            .select("id, message_id, flagged_by, reason, created_at")
            .in("message_id", messageIds);
          const byMsg: Record<string, FlagRow[]> = {};
          for (const f of (flagsData ?? []) as FlagRow[]) {
            if (!byMsg[f.message_id]) byMsg[f.message_id] = [];
            byMsg[f.message_id].push(f);
          }
          setFlagsByMessageId(byMsg);
        }
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [chatId, childId, router]);

  // Realtime: new messages in this chat
  useEffect(() => {
    if (!chatId) return;
    const channel = supabase
      .channel(`parent-chat:${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const newRow = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newRow.id)) return prev;
            return [...prev, newRow];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleFlag(messageId: string) {
    if (!user) return;
    const reason = window.prompt("Reason for flagging (optional):");
    if (reason === null) return;
    setFlaggingMessageId(messageId);
    setError(null);
    const { error: insertErr } = await supabase.from("flags").insert({
      message_id: messageId,
      flagged_by: user.id,
      reason: reason.trim() || null,
    });
    setFlaggingMessageId(null);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setFlagsByMessageId((prev) => {
      const list = prev[messageId] ?? [];
      return {
        ...prev,
        [messageId]: [...list, { id: 0, message_id: messageId, flagged_by: user.id, reason: reason.trim() || null, created_at: new Date().toISOString() }],
      };
    });
    try {
      await fetch("/api/moderation/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, flagged_by: user.id, reason: reason.trim() || null }),
      });
    } catch {
      // Placeholder API may not be deployed; ignore
    }
  }

  if (loading || !chatId || !childId) {
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
          <Link href={`/parent/children/${childId}`} className="mt-4 inline-block text-sm text-blue-600 hover:underline">
            ← Back to chats
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col bg-white">
      <div className="max-w-2xl mx-auto w-full flex flex-col flex-1 min-h-0">
        <header className="flex-shrink-0 flex items-center gap-4 px-4 py-3 border-b border-gray-200 bg-white">
          <Link
            href={`/parent/children/${childId}`}
            className="text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
            aria-label="Back to chats"
          >
            ← Chats
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">
              Chat: {childUser?.username ?? childUser?.email ?? childId} ↔ {otherUser?.email ?? "…"}
            </h1>
            <p className="text-xs text-gray-500">Read-only parent view</p>
          </div>
        </header>

        {error && (
          <p className="px-4 py-2 text-sm text-red-600 bg-red-50" role="alert">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0" role="log" aria-label="Chat messages">
          {messages.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-4">No messages yet.</p>
          )}
          {messages.map((msg) => {
            const isChild = msg.sender_id === childId;
            const isImage = msg.attachment_url && (msg.attachment_type?.startsWith("image/") ?? false);
            const flags = flagsByMessageId[msg.id] ?? [];
            const isFlagged = flags.length > 0;

            return (
              <div
                key={msg.id}
                className={`flex ${isChild ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                    isFlagged
                      ? "ring-2 ring-amber-500 bg-amber-50 dark:bg-amber-900/20"
                      : isChild
                        ? "bg-gray-200 text-gray-900 rounded-bl-md"
                        : "bg-blue-100 text-blue-900 rounded-br-md"
                  }`}
                >
                  {isImage && msg.attachment_url ? (
                    <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={msg.attachment_url} alt="" className="max-w-full max-h-[280px] object-contain" />
                    </a>
                  ) : msg.attachment_url ? (
                    <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" className="text-sm underline break-all">
                      Attachment
                    </a>
                  ) : null}
                  {(msg.content ?? "").trim() ? (
                    <p className="text-sm whitespace-pre-wrap break-words mt-1">{msg.content}</p>
                  ) : null}
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-xs text-gray-500">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleFlag(msg.id)}
                      disabled={flaggingMessageId === msg.id}
                      className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                      aria-label={`Flag this message${isFlagged ? " (already flagged)" : ""}`}
                    >
                      {flaggingMessageId === msg.id ? "…" : isFlagged ? "🚩 Flagged" : "Flag"}
                    </button>
                  </div>
                  {isFlagged && (
                    <p className="text-xs text-amber-700 mt-1" role="status">
                      Flagged: {flags.map((f) => f.reason || "No reason").join("; ")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </main>
  );
}
