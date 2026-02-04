"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import UnreadBadge from "@/components/UnreadBadge";

type Group = {
  id: string;
  name: string;
  created_by: string;
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

type MessageWithSender = Message & {
  sender: {
    id: string;
    first_name: string | null;
    surname: string | null;
    username: string | null;
    avatar_url: string | null;
  };
};

const BUCKET = "chat-media";

export default function GroupChatPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const groupId = params?.id as string | undefined;
  const [user, setUser] = useState<User | null>(null);
  const [isChild, setIsChild] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

        // Verify user is a member of the group
        const { data: membership } = await supabase
          .from("group_members")
          .select("id")
          .eq("group_id", groupId)
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (cancelled) return;

        if (!membership) {
          setError("You are not a member of this group");
          setLoading(false);
          return;
        }

        // Load group details
        const { data: groupData } = await supabase
          .from("groups")
          .select("id, name, created_by")
          .eq("id", groupId)
          .maybeSingle();

        if (cancelled) return;

        if (!groupData) {
          setError("Gruppe ikke fundet");
          setLoading(false);
          return;
        }

        setGroup(groupData);

        // Get or create chat
        const { data: { session: sessionForApi } } = await supabase.auth.getSession();
        if (!sessionForApi?.access_token) {
          setError("No session token");
          setLoading(false);
          return;
        }

        const chatRes = await fetch("/api/groups/get-or-create-chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionForApi.access_token}`,
          },
          body: JSON.stringify({ groupId }),
        });

        if (cancelled) return;

        if (!chatRes.ok) {
          const errorData = await chatRes.json().catch(() => ({}));
          setError(errorData.error || "Failed to get chat");
          setLoading(false);
          return;
        }

        const chatData = await chatRes.json();
        if (cancelled) return;

        setChatId(chatData.chatId);

        // Mark chat as read when opening
        if (chatData.chatId && session.user) {
          await supabase
            .from("chat_reads")
            .upsert(
              { user_id: session.user.id, chat_id: chatData.chatId, last_read_at: new Date().toISOString() },
              { onConflict: "user_id,chat_id" }
            );
        }

        // Load messages
        await loadMessages(chatData.chatId);

        setLoading(false);

        return () => {
          cancelled = true;
        };
      } catch (err) {
        if (cancelled) return;
        console.error("Error loading group chat:", err);
        setError(err instanceof Error ? err.message : "An error occurred");
        setLoading(false);
      }
    }

    load();
  }, [groupId, router]);

  // Realtime: new messages (same pattern as direct chat)
  useEffect(() => {
    if (!chatId || !user) return;
    const channel = supabase
      .channel(`group-chat:${chatId}`, { config: { presence: { key: user.id } } })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        async (payload) => {
          const newRow = payload.new as Message;
          console.log("Received message via subscription:", newRow.id, newRow.content);
          
          // Load sender info for the new message
          const { data: senderData } = await supabase
            .from("users")
            .select("id, first_name, surname, username, avatar_url")
            .eq("id", newRow.sender_id)
            .maybeSingle();

          const newMessage: MessageWithSender = {
            ...newRow,
            sender: senderData || {
              id: newRow.sender_id,
              first_name: null,
              surname: null,
              username: null,
              avatar_url: null,
            },
          };
          
          setMessages((prev) => {
            // Check if message already exists by ID
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            // Add the new message
            return [...prev, newMessage];
          });
          
          // Mark as read when new message arrives (if user is viewing)
          if (user && chatId) {
            Promise.resolve(
              supabase
                .from("chat_reads")
                .upsert(
                  { user_id: user.id, chat_id: chatId, last_read_at: new Date().toISOString() },
                  { onConflict: "user_id,chat_id" }
                )
            )
              .then(({ error }) => {
                if (error) {
                  console.error("Error marking as read:", error);
                }
              })
              .catch(err => console.error("Error marking as read:", err));
          }
        }
      )
      .subscribe(async (status) => {
        console.log("Subscription status:", status);
        if (status === "SUBSCRIBED") {
          await channel.track({ typing: false });
        }
      });
    channelRef.current = channel;

    // Also set up polling as fallback (every 2 seconds)
    const pollInterval = setInterval(() => {
      if (!chatId) return;
      loadMessages(chatId);
    }, 2000);

    return () => {
      channelRef.current = null;
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [chatId, user]);

  async function loadMessages(chatIdToLoad: string) {
    if (!chatIdToLoad) return;

    const { data: messagesData, error: messagesErr } = await supabase
      .from("messages")
      .select(`
        id,
        chat_id,
        sender_id,
        content,
        created_at,
        attachment_url,
        attachment_type,
        sender:users!messages_sender_id_fkey (
          id,
          first_name,
          surname,
          username,
          avatar_url
        )
      `)
      .eq("chat_id", chatIdToLoad)
      .order("created_at", { ascending: true })
      .limit(100);

    if (messagesErr) {
      console.error("Error loading messages:", messagesErr);
      return;
    }

    // Supabase returns nested relations as arrays, convert to single object
    const processedMessages = (messagesData || []).map((msg: any) => ({
      ...msg,
      sender: Array.isArray(msg.sender) ? msg.sender[0] : msg.sender,
    })) as MessageWithSender[];
    
    setMessages(processedMessages);
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Scroll to bottom when chat loads and messages are ready
  useEffect(() => {
    if (!loading && messages.length > 0) {
      // Use setTimeout to ensure DOM is ready
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 100);
    }
  }, [loading, messages.length]);

  const isActive = (path: string) => pathname === path;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!chatId || !content.trim() || sending || !user) return;

    setSending(true);
    const text = content.trim();
    const optimistic: MessageWithSender = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      sender_id: user.id,
      content: text,
      created_at: new Date().toISOString(),
      attachment_url: null,
      attachment_type: null,
      sender: {
        id: user.id,
        first_name: null,
        surname: null,
        username: null,
        avatar_url: null,
      },
    };
    setMessages((prev) => [...prev, optimistic]);
    setContent("");
    setError(null);

    try {
      const { data: newMessage, error: insertErr } = await supabase
        .from("messages")
        .insert({
          chat_id: chatId,
          sender_id: user.id,
          content: text,
        })
        .select("id, chat_id, sender_id, content, created_at, attachment_url, attachment_type")
        .maybeSingle();

      setSending(false);

      if (insertErr || !newMessage) {
        console.error("Error sending message:", insertErr);
        setError(insertErr?.message || "Failed to send message");
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        return;
      }

      setMessages((prev) => {
        const hasRealMessage = prev.some((m) => m.id === newMessage.id);
        if (hasRealMessage) {
          return prev.filter((m) => m.id !== optimistic.id);
        }
        return prev.map((m) =>
          m.id === optimistic.id
            ? {
                ...newMessage,
                sender: {
                  id: user.id,
                  first_name: null,
                  surname: null,
                  username: null,
                  avatar_url: null,
                },
              }
            : m
        );
      });
    } catch (err) {
      console.error("Error sending message:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setSending(false);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    }
  }

  function handleOpenImagePicker() {
    setShowImagePicker(true);
  }

  function handleSelectFromGallery() {
    setShowImagePicker(false);
    fileInputRef.current?.click();
  }

  function handleTakePhoto() {
    setShowImagePicker(false);
    cameraInputRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !chatId || !user || uploading) return;

    setUploading(true);
    setShowImagePicker(false);

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${chatId}/${fileName}`;

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadErr) {
        console.error("Error uploading file:", uploadErr);
        setError("Failed to upload image");
        setUploading(false);
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(filePath);

      const { error: insertErr } = await supabase
        .from("messages")
        .insert({
          chat_id: chatId,
          sender_id: user.id,
          attachment_url: publicUrl,
          attachment_type: file.type,
        })
        .select("id")
        .maybeSingle();

      if (insertErr) {
        console.error("Error creating message:", insertErr);
        setError("Failed to create message");
        setUploading(false);
        return;
      }

      setUploading(false);
    } catch (err) {
      console.error("Error uploading image:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setUploading(false);
    }

    // Reset file inputs
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
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
          <Link href="/groups" className="mt-4 inline-block text-sm text-[#E0785B] hover:underline">
            ← Tilbage til grupper
          </Link>
        </div>
      </main>
    );
  }

  if (!group || !chatId) return null;

  return (
    <main className="min-h-screen flex flex-col bg-[#C4E6CA] safe-area-inset" style={{ paddingBottom: isChild ? '128px' : '100px' }}>
      <div className="max-w-2xl mx-auto w-full flex-1 min-h-0 bg-[#E2F5E6]" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
        <header className="flex-shrink-0 flex items-center gap-3 sm:gap-4 px-4 py-3 sm:py-4 border-b border-gray-200 bg-[#E2F5E6] safe-area-inset-top">
          <Link
            href="/groups"
            className="text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#E0785B] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center touch-manipulation"
            aria-label="Tilbage til grupper"
          >
            ← Grupper
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">{group.name}</h1>
            <p className="text-xs text-gray-500">Gruppe chat</p>
          </div>
          <Link
            href={`/groups/${groupId}/members`}
            className="text-sm text-[#E0785B] hover:text-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center touch-manipulation"
            aria-label="Se medlemmer"
          >
            Medlemmer
          </Link>
        </header>

        {error && (
          <div className="flex-shrink-0 px-4 py-2 bg-red-50 border-b border-red-200" role="alert">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div
          className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
          role="log"
          aria-label="Chat messages"
          style={{ paddingBottom: '80px' }}
        >
          {messages.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-4">
              Ingen beskeder endnu. Sig hej!
            </p>
          )}
          {messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;
            const isImage = msg.attachment_url && (msg.attachment_type?.startsWith("image/") ?? false);

            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? "justify-start" : "justify-end"}`}
              >
                {!isMe && (
                  <div className="flex-shrink-0 ml-2 order-2">
                    {msg.sender.avatar_url ? (
                      <img
                        src={msg.sender.avatar_url}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover bg-gray-200"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const fallback = target.nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <span
                      className={`h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-medium ${msg.sender.avatar_url ? 'hidden' : ''}`}
                      aria-hidden="true"
                    >
                      {displayName(msg.sender)[0]?.toUpperCase() || "?"}
                    </span>
                  </div>
                )}
                <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3 py-2 ${
                  isMe
                    ? "bg-gray-300 text-gray-900 rounded-bl-md"
                    : "bg-[#E0785B] text-white rounded-br-md"
                }`}>
                  {!isMe && (
                    <p className="text-xs font-medium text-gray-600 mb-1">
                      {displayName(msg.sender)}
                    </p>
                  )}
                  {isImage && msg.attachment_url ? (
                    <div>
                      <a
                        href={msg.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600"
                      >
                        <img
                          src={msg.attachment_url}
                          alt=""
                          className="max-w-full max-h-[280px] object-contain"
                        />
                      </a>
                    </div>
                  ) : msg.attachment_url ? (
                    <a
                      href={msg.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm underline break-all"
                    >
                      Attachment
                    </a>
                  ) : null}
                  {(msg.content ?? "").trim() ? (
                    <p className="text-sm whitespace-pre-wrap break-words mt-1">
                      {msg.content}
                    </p>
                  ) : null}
                  <p className={`text-xs mt-1 ${
                    isMe ? "text-white/80" : "text-gray-500"
                  }`}>
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSend}
          className="fixed bg-[#E2F5E6] px-4 py-2"
          style={{ 
            bottom: isChild ? 'calc(90px + env(safe-area-inset-bottom))' : 'calc(64px + env(safe-area-inset-bottom))',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '100%',
            maxWidth: '42rem',
            zIndex: 45
          }}
        >
          <div className="flex gap-2 w-full">
          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileChange}
            aria-label="Select image from gallery"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onFileChange}
            aria-label="Take photo with camera"
          />
          <button
            type="button"
            onClick={handleOpenImagePicker}
            disabled={uploading}
            className="flex-shrink-0 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-600 hover:bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B] disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Attach image"
            title="Attach image"
          >
            {uploading ? "…" : "📷"}
          </button>

          {/* Image picker popup */}
          {showImagePicker && (
            <>
              <div
                className="fixed inset-0 bg-black/50 z-40"
                onClick={() => setShowImagePicker(false)}
                aria-hidden="true"
              />
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
                <div
                  className="bg-[#E2F5E6] rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Vælg billede</h3>
                    <p className="text-sm text-gray-500 mt-1">Hvordan vil du tilføje et billede?</p>
                  </div>
                  <div className="p-2">
                    <button
                      type="button"
                      onClick={handleSelectFromGallery}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#E0785B] transition-colors"
                    >
                      <span className="text-2xl">🖼️</span>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">Vælg fra fotoapp</div>
                        <div className="text-sm text-gray-500">Vælg et eksisterende billede</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={handleTakePhoto}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors mt-2"
                    >
                      <span className="text-2xl">📷</span>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">Tag nyt billede</div>
                        <div className="text-sm text-gray-500">Brug kameraet til at tage et nyt billede</div>
                      </div>
                    </button>
                  </div>
                  <div className="p-2 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => setShowImagePicker(false)}
                      className="w-full px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors min-h-[44px]"
                    >
                      Annuller
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Skriv en besked…"
            disabled={sending}
            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 min-h-[44px]"
            aria-label="Message input"
          />
          <button
            type="submit"
            disabled={sending || !content.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none min-h-[44px]"
            aria-label="Send message"
          >
            Send
          </button>
          </div>
        </form>
      </div>

      {/* Bottom Navigation Bar - For children */}
      {isChild && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom" style={{ zIndex: 40 }}>
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

      {/* Bottom Navigation Bar - For parents */}
      {!isChild && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom" style={{ zIndex: 40 }}>
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
      )}
    </main>
  );
}
