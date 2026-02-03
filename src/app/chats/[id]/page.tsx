"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
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
  username?: string | null;
  first_name?: string | null;
  surname?: string | null;
  avatar_url?: string | null;
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

/** Flag row from flags table (Phase 6: moderation) */
type FlagRow = {
  id: number;
  message_id: string;
  flagged_by: string;
  reason: string | null;
  created_at: string;
};

/** Parent invitation chat: child A invited child B; this chat is between Parent A and Parent B */
type ParentInvitationRow = {
  id: number;
  chat_id: string;
  inviting_child_id: string;
  invited_child_id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
};

const TYPING_DEBOUNCE_MS = 2000;
const BUCKET = "chat-media";

/**
 * Renders message content with clickable links
 * Detects URLs and paths like /chats/[id] and makes them clickable
 */
function renderMessageWithLinks(content: string) {
  if (!content) return null;
  
  // Pattern to match URLs and paths like /chats/[uuid]
  const linkPattern = /(https?:\/\/[^\s]+|\/chats\/[a-f0-9-]+)/gi;
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match;
  
  while ((match = linkPattern.exec(content)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    
    // Add the link
    const url = match[0];
    const isExternal = url.startsWith('http://') || url.startsWith('https://');
    
    parts.push(
      <Link
        key={match.index}
        href={url}
        className="underline text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
      >
        {url}
      </Link>
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }
  
  // If no links found, return original content
  if (parts.length === 0) {
    return content;
  }
  
  return <>{parts}</>;
}

export default function ChatDetailPage() {
  const router = useRouter();
  const params = useParams();
  const chatId = params?.id as string | undefined;
  const [user, setUser] = useState<User | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [otherUser, setOtherUser] = useState<UserRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flagsByMessageId, setFlagsByMessageId] = useState<Record<string, FlagRow[]>>({});
  const [flaggingMessageId, setFlaggingMessageId] = useState<string | null>(null);
  const [parentInvitation, setParentInvitation] = useState<ParentInvitationRow | null>(null);
  const [isInvitedParent, setIsInvitedParent] = useState(false);
  const [invitationActionId, setInvitationActionId] = useState<number | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [parentLinks, setParentLinks] = useState<{ child_id: string; surveillance_level: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  /** Reload flags for the current chat */
  const loadFlags = useCallback(async () => {
    if (!chatId || !user) return;
    const messageIds = messages.map((m) => m.id).filter((id): id is string => !!id);
    if (messageIds.length === 0) {
      setFlagsByMessageId({});
      return;
    }
    const { data: flagsData, error: flagsError } = await supabase
      .from("flags")
      .select("id, message_id, flagged_by, reason, created_at")
      .in("message_id", messageIds);
    
    if (flagsError) {
      // Safe error logging
      try {
        if (flagsError && typeof flagsError === "object" && Object.keys(flagsError).length > 0) {
          console.error("Error loading flags:", flagsError);
        } else {
          console.error("Unknown error occurred:", flagsError);
        }
      } catch (logErr) {
        console.error("Error occurred but could not be logged:", String(flagsError || "Unknown"));
      }
      return;
    }
    
    const byMsg: Record<string, FlagRow[]> = {};
    const safeFlagsData = (flagsData ?? []) as FlagRow[];
    for (const f of safeFlagsData) {
      if (f && f.message_id) {
        if (!byMsg[f.message_id]) byMsg[f.message_id] = [];
        byMsg[f.message_id].push(f);
      }
    }
    setFlagsByMessageId(byMsg);
  }, [chatId, user, messages]);

  // Mark chat as read when opening
  useEffect(() => {
    if (!chatId || !user) return;
    supabase
      .from("chat_reads")
      .upsert(
        { user_id: user.id, chat_id: chatId, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,chat_id" }
      )
      .then(({ error }) => {
        if (error) {
          // Safe error logging
          try {
            if (error && typeof error === "object" && Object.keys(error).length > 0) {
              console.error("Error marking chat as read:", error);
            } else {
              console.error("Unknown error occurred:", error);
            }
          } catch (logErr) {
            console.error("Error occurred but could not be logged:", String(error || "Unknown"));
          }
        }
      });
  }, [chatId, user]);

  useEffect(() => {
    if (!chatId) {
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
      
      // Check if user is a direct participant
      const isDirectParticipant = c.user1_id === uid || c.user2_id === uid;
      
      // Check if user is a parent of either participant (for surveillance level check)
      let parentSurveillanceLevel: "strict" | "medium" | "mild" | null = null;
      let shouldAllowAccess = false;
      
      let linksData: { child_id: string; surveillance_level: string } | null = null;
      try {
        if (!cancelled) {
          const { data } = await supabase
            .from("parent_child_links")
            .select("child_id, surveillance_level")
            .eq("parent_id", uid)
            .in("child_id", [c.user1_id, c.user2_id])
            .limit(1)
            .maybeSingle();
          
          if (!cancelled) {
            linksData = data;
            setParentLinks(data);
          }
        }
      } catch (err) {
        console.error("Error checking parent links:", err);
        if (!cancelled) {
          setError("Error checking access permissions");
          setLoading(false);
          return;
        }
      }
      
      if (cancelled) return;
      
      // If user is a direct participant, allow access (they're part of the chat)
      // For parent-to-parent chats, this is fine. For child chats, children can access their own chats.
      if (isDirectParticipant) {
        shouldAllowAccess = true;
      } else if (linksData) {
        // Not a direct participant, but is a parent of one of the children
        parentSurveillanceLevel = linksData.surveillance_level as "strict" | "medium" | "mild" | null;
        
        if (linksData.surveillance_level === "strict") {
          shouldAllowAccess = true;
        } else if (linksData.surveillance_level === "medium") {
            // Must check for flagged messages - default deny
            shouldAllowAccess = false;
            
            try {
              // Use API route with service role to bypass RLS issues
              const { data: { session } } = await supabase.auth.getSession();
              if (cancelled) return;
              
              if (!session?.access_token) {
                console.warn("Medium level parent: No session token - denying access");
                shouldAllowAccess = false;
              } else {
                console.log("🔍 Medium level parent: Checking flagged messages via API", {
                  chatId,
                  parentId: uid,
                  childId: linksData.child_id
                });

                const apiResponse = await fetch(
                  `/api/parent/check-flagged-messages?chatId=${encodeURIComponent(chatId || "")}&parentId=${encodeURIComponent(uid)}`,
                  {
                    headers: {
                      Authorization: `Bearer ${session.access_token}`,
                    },
                  }
                );

                if (cancelled) return;

                if (apiResponse.ok) {
                  const data = await apiResponse.json();
                  const hasFlaggedMessages = data.hasFlaggedMessages === true;

                  console.log("🔍 Medium level parent: API check result", {
                    chatId,
                    parentId: uid,
                    hasFlaggedMessages,
                    flaggedCount: data.flaggedCount || 0,
                    messageCount: data.messageCount || 0
                  });

                  if (hasFlaggedMessages) {
                    console.log("✅ Medium level parent: Allowing access - flagged messages found via API");
                    shouldAllowAccess = true;
                  } else {
                    console.log("❌ Medium level parent: Denying access - no flagged messages found via API");
                    shouldAllowAccess = false;
                  }
                } else {
                  const errorText = await apiResponse.text().catch(() => apiResponse.statusText);
                  console.error("❌ Medium level parent: API check failed", {
                    status: apiResponse.status,
                    error: errorText
                  });
                  // On API error, deny access for safety
                  shouldAllowAccess = false;
                }
              }
            } catch (err) {
              // Safe error logging
              try {
                if (err && typeof err === "object" && Object.keys(err).length > 0) {
                  console.error("Error checking flagged messages via API:", err);
                } else {
                  console.error("Unknown error occurred:", err);
                }
              } catch (logErr) {
                console.error("Error occurred but could not be logged:", String(err || "Unknown"));
              }
              // On error, deny access for safety
              shouldAllowAccess = false;
            }
        } else {
          // Mild level - no access
          shouldAllowAccess = false;
        }
      } else {
        // Not a direct participant and not a parent - deny access
        shouldAllowAccess = false;
      }
      
      if (cancelled) return;
      
      if (!shouldAllowAccess) {
        if (parentSurveillanceLevel === "mild") {
          setError("You have 'Mild' surveillance level. You can only see chats when your child flags a message.");
        } else if (parentSurveillanceLevel === "medium") {
          setError("You have 'Medium' surveillance level. You can only access chats after receiving a keyword notification. This chat has no flagged messages.");
        } else {
          setError("You don't have access to this chat");
        }
        setLoading(false);
        return;
      }

      setChat(c);

      if (cancelled) return;
      
      // Determine the "other" user - for parents, show the child who is not their own
      let otherId: string;
      if (isDirectParticipant) {
        otherId = c.user1_id === uid ? c.user2_id : c.user1_id;
      } else if (parentLinks) {
        // User is a parent - find which child is theirs and which is the other
        const myChildId = parentLinks.child_id;
        otherId = myChildId === c.user1_id ? c.user2_id : c.user1_id;
      } else {
        // Fallback
        otherId = c.user1_id === uid ? c.user2_id : c.user1_id;
      }
      if (cancelled) return;
      
      const { data: ownUser, error: ownUserError } = await supabase.from("users").select("username").eq("id", uid).maybeSingle();
      if (cancelled) return;
      
      if (ownUserError) {
        console.error("Error loading own user:", ownUserError);
      }
      
      const isChild = !!(ownUser?.username != null && String(ownUser.username).trim() !== "");
      if (isChild) {
        const { data: approved, error: approvedError } = await supabase
          .from("parent_approved_contacts")
          .select("contact_user_id")
          .eq("child_id", uid)
          .eq("contact_user_id", otherId)
          .maybeSingle();
        
        if (cancelled) return;
        
        if (approvedError) {
          // Safe error logging
          try {
            if (approvedError && typeof approvedError === "object" && Object.keys(approvedError).length > 0) {
              console.error("Error checking approved contacts:", approvedError);
            } else {
              console.error("Unknown error occurred:", approvedError);
            }
          } catch (logErr) {
            console.error("Error occurred but could not be logged:", String(approvedError || "Unknown"));
          }
        }
        if (!approved) {
          setError("This chat is waiting for your parent to accept this contact. They have been notified.");
          setLoading(false);
          return;
        }
      }
      if (cancelled) return;
      
      let userRes = await supabase.from("users").select("id, email, username, first_name, surname, avatar_url").eq("id", otherId).maybeSingle();
      if (cancelled) return;
      
      if (userRes.error && /username|first_name|surname|avatar_url|schema cache|column/i.test(userRes.error.message)) {
        userRes = await supabase.from("users").select("id, email, username").eq("id", otherId).maybeSingle();
        if (cancelled) return;
      }
      if (userRes.error) {
        // Safe error logging
        try {
          if (userRes.error && typeof userRes.error === "object" && Object.keys(userRes.error).length > 0) {
            console.error("Error loading other user:", userRes.error);
          } else {
            console.error("Unknown error occurred:", userRes.error);
          }
        } catch (logErr) {
          console.error("Error occurred but could not be logged:", String(userRes.error || "Unknown"));
        }
      }
      const { data: userData } = userRes;

      if (userData) {
        setOtherUser(userData as UserRow);
      }

      if (cancelled) return;
      
      const { data: messagesData, error: messagesErr } = await supabase
        .from("messages")
        .select("id, chat_id, sender_id, content, created_at, attachment_url, attachment_type")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      
      if (messagesErr) {
        // Safe error logging
        try {
          if (messagesErr && typeof messagesErr === "object" && Object.keys(messagesErr).length > 0) {
            console.error("Error loading messages:", messagesErr);
          } else {
            console.error("Unknown error occurred:", messagesErr);
          }
        } catch (logErr) {
          console.error("Error occurred but could not be logged:", String(messagesErr || "Unknown"));
        }
        setError(messagesErr?.message || "Failed to load messages");
      } else {
        // Safe fallback for data
        setMessages((messagesData ?? []) as Message[]);
      }

      // Phase 6: fetch flags for messages in this chat (for Flag button + visual indicator)
      const safeMessagesData = (messagesData ?? []) as Message[];
      if (safeMessagesData.length > 0) {
        const messageIds = safeMessagesData.map((m) => m.id).filter((id): id is string => !!id);
        if (messageIds.length > 0) {
          const { data: flagsData, error: flagsError } = await supabase
            .from("flags")
            .select("id, message_id, flagged_by, reason, created_at")
            .in("message_id", messageIds);
          
          if (cancelled) return;
          
          if (flagsError) {
            // Safe error logging
            try {
              if (flagsError && typeof flagsError === "object" && Object.keys(flagsError).length > 0) {
                console.error("Error loading flags:", flagsError);
              } else {
                console.error("Unknown error occurred:", flagsError);
              }
            } catch (logErr) {
              console.error("Error occurred but could not be logged:", String(flagsError || "Unknown"));
            }
          }
          const byMsg: Record<string, FlagRow[]> = {};
          const safeFlagsData = (flagsData ?? []) as FlagRow[];
          for (const f of safeFlagsData) {
            if (f && f.message_id) {
              if (!byMsg[f.message_id]) byMsg[f.message_id] = [];
              byMsg[f.message_id].push(f);
            }
          }
          setFlagsByMessageId(byMsg);
        } else {
          // No message IDs - set empty flags map
          setFlagsByMessageId({});
        }
      } else {
        // No messages - set empty flags map
        setFlagsByMessageId({});
      }

      if (cancelled) return;

      // Parent invitation chat: is this chat an invitation from another parent?
      // Load all invitations for this chat (there can be multiple if different child pairs)
      if (cancelled) return;
      
      const { data: invitationDataList, error: invErr } = await supabase
        .from("parent_invitation_chats")
        .select("id, chat_id, inviting_child_id, invited_child_id, status, created_at")
        .eq("chat_id", chatId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      
      if (cancelled) return;
      
      if (invErr) {
        // Log error but don't block the page - invitation feature might not be set up
        const errMsg = invErr.message || JSON.stringify(invErr) || String(invErr);
        console.warn("Could not load parent invitation:", errMsg);
        console.warn("Full error object:", invErr);
        console.warn("Chat ID:", chatId, "User ID:", uid);
        // Check if error is about table not existing
        if (errMsg && /does not exist|relation.*parent_invitation_chats/i.test(errMsg)) {
          console.warn("⚠️ parent_invitation_chats table doesn't exist. Run migration 008_parent_invitation_chats.sql");
        } else if (errMsg && /permission|policy|RLS/i.test(errMsg)) {
          console.warn("⚠️ RLS policy issue. Run migration 009_fix_parent_invitation_rls.sql");
        }
      }
      
      const invitations = (invitationDataList ?? []) as ParentInvitationRow[];
      if (invitations.length > 0) {
        // Get the first pending invitation (most recent)
        const inv = invitations[0];
        console.log("Found invitation(s):", invitations.length, "Using:", inv);
        setParentInvitation(inv);
        
        if (cancelled) return;
        
        // Check if current user is parent of either the inviting child or invited child
        const { data: myLinkInviting } = await supabase
          .from("parent_child_links")
          .select("parent_id")
          .eq("parent_id", uid)
          .eq("child_id", inv.inviting_child_id)
          .maybeSingle();
        
        if (cancelled) return;
        
        const { data: myLinkInvited } = await supabase
          .from("parent_child_links")
          .select("parent_id")
          .eq("parent_id", uid)
          .eq("child_id", inv.invited_child_id)
          .maybeSingle();
        
        if (cancelled) return;
        
        // Show Accept/Reject to either parent (inviting or invited) if status is pending
        const canManage = !!(myLinkInviting || myLinkInvited);
        if (inv.status === "pending" && canManage) {
          setIsInvitedParent(true);
          console.log("Setting isInvitedParent=true, invitation:", { id: inv.id, status: inv.status, canManage });
        } else {
          console.log("Not showing buttons:", { status: inv.status, canManage, myLinkInviting: !!myLinkInviting, myLinkInvited: !!myLinkInvited });
        }
      } else {
        console.log("No pending parent invitation found for chat:", chatId);
      }
      
      if (cancelled) return;
      
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [chatId, router]);

  // Realtime: new messages + presence (typing)
  useEffect(() => {
    if (!chatId || !user) return;
    const channel = supabase
      .channel(`chat:${chatId}`, { config: { presence: { key: user.id } } })
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
            // Check if message already exists by ID
            if (prev.some((m) => m.id === newRow.id)) return prev;
            // Add the new message
            return [...prev, newRow];
          });
        }
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const others = Object.keys(state).filter((key) => key !== user.id);
        const typing = others.some(
          (key) => (state[key]?.[0] as { typing?: boolean })?.typing === true
        );
        setOtherTyping(typing);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ typing: false });
        }
      });
    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [chatId, user]);

  const setTyping = useCallback((typing: boolean) => {
    const ch = channelRef.current;
    if (!ch) return;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    ch.track({ typing });
    if (typing) {
      typingTimeoutRef.current = setTimeout(() => {
        ch.track({ typing: false });
        typingTimeoutRef.current = null;
      }, TYPING_DEBOUNCE_MS);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !chatId || sending) return;
    const text = (content || "").trim();
    if (!text) return;
    setContent("");
    setSending(true);
    setError(null);
    const optimistic: Message = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      sender_id: user.id,
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    const { data: inserted, error: insertErr } = await supabase
      .from("messages")
      .insert({ chat_id: chatId, sender_id: user.id, content: text })
      .select("id, chat_id, sender_id, content, created_at, attachment_url, attachment_type")
      .maybeSingle();
    setSending(false);
    if (insertErr || !inserted) {
      // Safe error logging
      try {
        if (insertErr && typeof insertErr === "object" && Object.keys(insertErr).length > 0) {
          console.error("Error inserting message:", insertErr);
        } else {
          console.error("Unknown error occurred:", insertErr);
        }
      } catch (logErr) {
        console.error("Error occurred but could not be logged:", String(insertErr || "Unknown"));
      }
      setError(insertErr?.message || "Failed to send message");
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      return;
    }
    setMessages((prev) => {
      // Replace optimistic message with real message, ensuring no duplicates
      const hasRealMessage = prev.some((m) => m.id === inserted.id);
      if (hasRealMessage) {
        // Real message already exists (from realtime), remove optimistic one
        return prev.filter((m) => m.id !== optimistic.id);
      } else {
        // Replace optimistic with real message
        return prev.map((m) => (m.id === optimistic.id ? (inserted as Message) : m));
      }
    });

    // Scan message for safety keywords (non-blocking, only for children)
    if (inserted?.id) {
      // Check if sender is a child (has username)
      const { data: senderUser, error: senderUserError } = await supabase
        .from("users")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();
      
      if (senderUserError) {
        // Safe error logging
        try {
          if (senderUserError && typeof senderUserError === "object" && Object.keys(senderUserError).length > 0) {
            console.error("Error checking if sender is child:", senderUserError);
          } else {
            console.error("Unknown error occurred:", senderUserError);
          }
        } catch (logErr) {
          console.error("Error occurred but could not be logged:", String(senderUserError || "Unknown"));
        }
        // Continue anyway - don't block message sending
      }
      
      const isChild = !!(senderUser?.username != null && String(senderUser.username).trim() !== "");
      
      if (isChild) {
        // IMPORTANT: Scan ALL messages from children, regardless of sender's parent surveillance level
        // This is because the RECIPIENT's parent might have medium/strict surveillance
        // and needs to see flagged messages even if sender's parent doesn't monitor
        // Fire and forget - don't block on this
        console.log("🔍 [Keyword Scanner] Scanning message from child:", user.id, "in chat:", chatId, "message:", inserted.id);
        fetch("/api/messages/scan-and-flag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: inserted.id,
            childId: user.id,
            messageText: text,
            chatId: chatId,
          }),
        })
        .then(async (res) => {
          if (!res.ok) {
            const errorText = await res.text().catch(() => res.statusText);
            console.error("⚠️ [Keyword Scanner] API returned error:", res.status, errorText);
          } else {
            try {
              const data = await res.json();
              if (data.flagged) {
                console.log(`✅ [Keyword Scanner] Message flagged: ${data.category} - "${data.keyword}"`);
                console.log(`✅ [Keyword Scanner] Flagged message should be in database: messageId=${inserted.id}, childId=${user.id}`);
              } else {
                console.log("✅ [Keyword Scanner] Message is clean, no keywords found");
              }
            } catch (err) {
              console.error("⚠️ [Keyword Scanner] Failed to parse response:", err);
            }
          }
        })
        .catch((err) => {
          // Silently fail - scanning should never block message sending
          console.error("⚠️ [Keyword Scanner] Failed to scan message for keywords:", err);
        });
      }
    }
  }

  async function handleImageUpload(file: File) {
    if (!user || !chatId || uploading) return;
    const path = `${chatId}/${crypto.randomUUID()}.${file.name.split(".").pop() || "jpg"}`;
    setUploading(true);
    setError(null);
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadErr) {
      setError(uploadErr.message);
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const attachmentUrl = urlData.publicUrl;
    const { data: inserted, error: insertErr } = await supabase
      .from("messages")
      .insert({
        chat_id: chatId,
        sender_id: user.id,
        content: "",
        attachment_url: attachmentUrl,
        attachment_type: file.type,
      })
      .select("id, chat_id, sender_id, content, created_at, attachment_url, attachment_type")
      .maybeSingle();
    setUploading(false);
    if (insertErr || !inserted) {
      // Safe error logging
      try {
        if (insertErr && typeof insertErr === "object" && Object.keys(insertErr).length > 0) {
          console.error("Error inserting image message:", insertErr);
        } else {
          console.error("Unknown error occurred:", insertErr);
        }
      } catch (logErr) {
        console.error("Error occurred but could not be logged:", String(insertErr || "Unknown"));
      }
      setError(insertErr?.message || "Failed to upload image");
      return;
    }
    if (inserted) {
      setMessages((prev) => [...prev, inserted as Message]);
      
      // Scan image for NSFW content (non-blocking, fire and forget)
      // Only scan if user is a child
      const { data: userData } = await supabase
        .from("users")
        .select("is_child")
        .eq("id", user.id)
        .maybeSingle();
      
      const isChild = userData?.is_child ?? false;
      
      if (isChild) {
        // Fire and forget - don't block on this
        fetch("/api/moderation/scan-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: inserted.id,
            imageUrl: attachmentUrl,
            childId: user.id,
            chatId: chatId,
          }),
        })
        .then(async (res) => {
          if (!res.ok) {
            const errorText = await res.text().catch(() => res.statusText);
            console.error("⚠️ [Image Scanner] API returned error:", res.status, errorText);
          } else {
              try {
                const data = await res.json();
                if (data && data.flagged) {
                  console.log(`⚠️ [Image Scanner] Image flagged: ${data.reason || data.category} (confidence: ${data.confidence})`);
                  // Refresh flags to show the new flag (only if loadFlags is available)
                  // Use setTimeout to avoid calling during render
                  setTimeout(() => {
                    if (typeof loadFlags === "function") {
                      loadFlags().catch((flagErr) => {
                        // Safe error logging
                        try {
                          if (flagErr && typeof flagErr === "object" && Object.keys(flagErr).length > 0) {
                            console.error("Error reloading flags:", flagErr);
                          } else {
                            console.error("Unknown error occurred:", flagErr);
                          }
                        } catch (logErr) {
                          console.error("Error occurred but could not be logged:", String(flagErr || "Unknown"));
                        }
                      });
                    }
                  }, 100);
                }
              } catch (err) {
                // Safe error logging
                try {
                  if (err && typeof err === "object" && Object.keys(err).length > 0) {
                    console.error("⚠️ [Image Scanner] Failed to parse response:", err);
                  } else {
                    console.error("⚠️ [Image Scanner] Unknown error occurred:", err);
                  }
                } catch (logErr) {
                  console.error("⚠️ [Image Scanner] Error occurred but could not be logged:", String(err || "Unknown"));
                }
              }
          }
        })
        .catch((err) => {
          // Silently fail - scanning should never block image sending
          console.error("⚠️ [Image Scanner] Failed to scan image:", err);
        });
      }
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      handleImageUpload(file);
      // Reset input so same file can be selected again
      e.target.value = "";
    }
    setShowImagePicker(false);
  };

  const handleOpenImagePicker = () => {
    setShowImagePicker(true);
  };

  const handleSelectFromGallery = () => {
    fileInputRef.current?.click();
  };

  const handleTakePhoto = () => {
    cameraInputRef.current?.click();
  };

  /** Accept the connection request: approve contact and update invitation status */
  async function handleAcceptInvitation() {
    if (!user || !parentInvitation || invitationActionId !== null) return;
    setInvitationActionId(parentInvitation.id);
    setError(null);
    
    // Check which parent is accepting (inviting or invited)
    const { data: linkInviting } = await supabase
      .from("parent_child_links")
      .select("parent_id")
      .eq("parent_id", user.id)
      .eq("child_id", parentInvitation.inviting_child_id)
      .maybeSingle();
    const { data: linkInvited } = await supabase
      .from("parent_child_links")
      .select("parent_id")
      .eq("parent_id", user.id)
      .eq("child_id", parentInvitation.invited_child_id)
      .maybeSingle();
    
    const isInvitingParent = !!linkInviting;
    const isInvitedParent = !!linkInvited;
    
    // Approve contacts for both children bidirectionally using API endpoint
    // This ensures both approvals are created with the correct parent_id (bypassing RLS)
    if (isInvitedParent || isInvitingParent) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const res = await fetch("/api/invitation/approve-bidirectional", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({
              inviting_child_id: parentInvitation.inviting_child_id,
              invited_child_id: parentInvitation.invited_child_id,
              accepting_parent_id: user.id,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            console.error("Failed to create bidirectional approvals:", data.error || res.statusText);
            setError(data.error || "Failed to approve contacts");
            setInvitationActionId(null);
            return;
          }
          console.log("Bidirectional approvals created successfully");
        } else {
          setError("Session expired. Please log in again.");
          setInvitationActionId(null);
          return;
        }
      } catch (err) {
        // Safe error logging
        try {
          if (err && typeof err === "object" && Object.keys(err).length > 0) {
            console.error("Error creating bidirectional approvals:", err);
          } else {
            console.error("Unknown error occurred:", err);
          }
        } catch (logErr) {
          console.error("Error occurred but could not be logged:", String(err || "Unknown"));
        }
        setError("Failed to approve contacts");
        setInvitationActionId(null);
        return;
      }
    } else {
      setError("You are not authorized to accept this invitation.");
      setInvitationActionId(null);
      return;
    }
    
    // Clean up pending requests
    await supabase.from("pending_contact_requests").delete().eq("child_id", parentInvitation.invited_child_id).eq("contact_user_id", parentInvitation.inviting_child_id);
    const { error: updateErr } = await supabase.from("parent_invitation_chats").update({ status: "accepted" }).eq("id", parentInvitation.id);
    
    // Send confirmation messages to Child B and Parent B
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const res = await fetch("/api/invitation/send-acceptance-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            inviting_child_id: parentInvitation.inviting_child_id,
            invited_child_id: parentInvitation.invited_child_id,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("Failed to send acceptance messages:", data.error || res.statusText);
        }
      }
    } catch (err) {
      // Safe error logging
      try {
        if (err && typeof err === "object" && Object.keys(err).length > 0) {
          console.error("Error sending acceptance messages:", err);
        } else {
          console.error("Unknown error occurred:", err);
        }
      } catch (logErr) {
        console.error("Error occurred but could not be logged:", String(err || "Unknown"));
      }
      // Non-fatal: continue even if message sending fails
    }
    
    setInvitationActionId(null);
    if (updateErr) {
      setError(updateErr.message);
    } else {
      setParentInvitation((prev) => (prev ? { ...prev, status: "accepted" } : null));
      // Don't reload - let the realtime updates handle it
    }
  }

  /** Reject the connection request */
  async function handleRejectInvitation() {
    if (!user || !parentInvitation || invitationActionId !== null) return;
    setInvitationActionId(parentInvitation.id);
    setError(null);
    await supabase.from("pending_contact_requests").delete().eq("child_id", parentInvitation.invited_child_id).eq("contact_user_id", parentInvitation.inviting_child_id);
    const { error: updateErr } = await supabase.from("parent_invitation_chats").update({ status: "rejected" }).eq("id", parentInvitation.id);
    setInvitationActionId(null);
    if (updateErr) setError(updateErr.message);
    else setParentInvitation((prev) => (prev ? { ...prev, status: "rejected" } : null));
  }

  /** Phase 6: insert flag and call moderation API placeholder */
  async function handleFlag(messageId: string) {
    if (!user) return;
    const reason = window.prompt("Grund til flagning (valgfrit):");
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
    setFlagsByMessageId((prev) => ({
      ...prev,
      [messageId]: [
        ...(prev[messageId] ?? []),
        {
          id: 0,
          message_id: messageId,
          flagged_by: user.id,
          reason: reason.trim() || null,
          created_at: new Date().toISOString(),
        },
      ],
    }));
    try {
      await fetch("/api/moderation/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: messageId,
          flagged_by: user.id,
          reason: reason.trim() || null,
        }),
      });
    } catch {
      // Placeholder API; ignore if not deployed
    }
  }

  if (loading || !chatId) {
    return (
      <main
        className="min-h-screen flex items-center justify-center p-4 sm:p-6"
        role="status"
        aria-label="Indlæser chat"
      >
        <p className="text-gray-500">Indlæser…</p>
      </main>
    );
  }

  if (!user || error) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-red-600" role="alert">
            {error ?? "Ikke fundet"}
          </p>
            <Link
              href="/chats"
              className="mt-4 inline-block text-sm text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
            >
              ← Tilbage til chats
            </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col bg-white safe-area-inset">
      <div className="max-w-2xl mx-auto w-full flex flex-col flex-1 min-h-0">
        <header className="flex-shrink-0 flex items-center gap-3 sm:gap-4 px-4 py-3 sm:py-4 border-b border-gray-200 bg-white safe-area-inset-top">
            <Link
              href="/chats"
              className="text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center touch-manipulation"
              aria-label="Tilbage til chats"
            >
              ← Chats
            </Link>
          {/* AVATAR VISNING I CHAT HEADER */}
          {/* Hvis den anden bruger har uploadet et avatar-billede (avatar_url findes), vises det */}
          {otherUser?.avatar_url ? (
            <img 
              src={otherUser.avatar_url} 
              alt={`${otherUser?.first_name || otherUser?.username || otherUser?.email || "User"}'s avatar`} 
              className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-gray-200"
              onError={(e) => {
                // Hvis billedet ikke kan indlæses, skjul img og vis standard-avatar i stedet
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                // Find næste sibling (standard-avatar span) og vis den
                const fallback = target.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = 'flex';
              }}
            />
          ) : null}
          {/* Standard-avatar: Vises hvis avatar_url ikke findes i databasen */}
          {/* Skjules automatisk hvis avatar_url findes, men vises igen hvis billedet ikke kan indlæses (via onError) */}
          <span 
            className={`h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium ${otherUser?.avatar_url ? 'hidden' : ''}`}
            aria-hidden="true"
          >
            {(otherUser?.first_name?.trim()?.[0] ?? otherUser?.username?.trim()?.[0] ?? otherUser?.email?.[0] ?? "…").toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">
              {otherUser?.first_name != null && otherUser?.surname != null && (otherUser.first_name.trim() || otherUser.surname.trim())
                ? `${otherUser.first_name.trim() || "?"} ${otherUser.surname.trim() || "?"}`
                : otherUser?.username ?? otherUser?.email ?? "…"}
            </h1>
            {otherTyping && (
              <p className="text-xs text-gray-500 mt-0.5" aria-live="polite">
                skriver…
              </p>
            )}
          </div>
        </header>


        <div
          className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
          role="log"
          aria-label="Chat messages"
        >
          {messages.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-4">
              Ingen beskeder endnu. Sig hej!
            </p>
          )}
          {messages
            .filter((msg, index, self) => 
              // Remove duplicates by ensuring each message ID appears only once
              index === self.findIndex((m) => m.id === msg.id)
            )
            .map((msg) => {
            const isMe = msg.sender_id === user.id;
            const isImage =
              msg.attachment_url &&
              (msg.attachment_type?.startsWith("image/") ?? false);
            const flags = flagsByMessageId[msg.id] ?? [];
            const isFlagged = flags.length > 0;
            // Check if this is the intro message that should have Accept/Reject buttons
            const isIntroMessage = msg.content && (
              msg.content.includes("wants to connect") || 
              msg.content.includes("Feel free to chat with me here")
            );
            const showInvitationButtons = isIntroMessage && 
              parentInvitation && 
              parentInvitation.status === "pending" && 
              isInvitedParent;
            
            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? "justify-end" : "justify-start"} ${showInvitationButtons ? "flex-col" : ""}`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3 py-2 ${
                    isFlagged
                      ? "ring-2 ring-amber-500 bg-amber-50 text-gray-900 rounded-br-md"
                      : isMe
                        ? "bg-blue-600 text-white rounded-br-md"
                        : "bg-gray-200 text-gray-900 rounded-bl-md"
                  } ${isFlagged && isMe ? "!bg-amber-100" : ""}`}
                >
                  {isImage && msg.attachment_url ? (
                    <div className={isFlagged ? "ring-2 ring-amber-500 rounded-lg overflow-hidden" : ""}>
                      <a
                        href={msg.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={msg.attachment_url}
                          alt=""
                          className={`max-w-full max-h-[280px] object-contain ${isFlagged ? "opacity-90" : ""}`}
                        />
                      </a>
                      {isFlagged && (
                        <div className="px-2 py-1 bg-amber-50 border-t border-amber-200">
                          <p className="text-xs text-amber-800 font-medium">🚩 Flagget billede</p>
                          {flags.length > 0 && flags[0].reason && (
                            <p className="text-xs text-amber-700 mt-0.5">{flags[0].reason}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : msg.attachment_url ? (
                    <a
                      href={msg.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm underline break-all"
                    >
                      Vedhæftet fil
                    </a>
                  ) : null}
                  {(msg.content ?? "").trim() ? (
                    <p className="text-sm whitespace-pre-wrap break-words mt-1">
                      {renderMessageWithLinks(msg.content ?? "")}
                    </p>
                  ) : null}
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p
                      className={`text-xs ${
                        isMe && !isFlagged ? "text-blue-200" : "text-gray-500"
                      }`}
                    >
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleFlag(msg.id)}
                      disabled={flaggingMessageId === msg.id}
                      className="text-xs px-2 py-1 rounded border border-gray-300 bg-white/80 hover:bg-white disabled:opacity-50 text-gray-700"
                      aria-label={isFlagged ? "Message flagged" : "Flag message"}
                    >
                      {flaggingMessageId === msg.id ? "…" : isFlagged ? "🚩 Flagget" : "Flag"}
                    </button>
                  </div>
                  {isFlagged && (
                    <div className="text-xs text-amber-700 mt-1" role="status">
                      <p>Flagget: {flags.map((f) => f.reason || "Ingen grund").join("; ")}</p>
                      {/* Show reviewed/override button for parents - check if user has parent links */}
                      {user && parentLinks && (
                        <button
                          type="button"
                          onClick={() => {
                            // Remove flags for this message (parent override)
                            (async () => {
                              try {
                                const flagIds = flags.map(f => f.id).filter((id): id is number => typeof id === "number");
                                if (flagIds.length === 0) return;
                                
                                const { error: deleteError } = await supabase
                                  .from("flags")
                                  .delete()
                                  .in("id", flagIds);
                                
                                if (deleteError) {
                                  // Safe error logging
                                  try {
                                    if (deleteError && typeof deleteError === "object" && Object.keys(deleteError).length > 0) {
                                      console.error("Error clearing flag:", deleteError);
                                    } else {
                                      console.error("Unknown error occurred:", deleteError);
                                    }
                                  } catch (logErr) {
                                    console.error("Error occurred but could not be logged:", String(deleteError || "Unknown"));
                                  }
                                } else {
                                  // Reload flags (only if function exists)
                                  if (typeof loadFlags === "function") {
                                    try {
                                      await loadFlags();
                                    } catch (flagErr) {
                                      // Safe error logging
                                      try {
                                        if (flagErr && typeof flagErr === "object" && Object.keys(flagErr).length > 0) {
                                          console.error("Error reloading flags:", flagErr);
                                        } else {
                                          console.error("Unknown error occurred:", flagErr);
                                        }
                                      } catch (logErr) {
                                        console.error("Error occurred but could not be logged:", String(flagErr || "Unknown"));
                                      }
                                    }
                                  }
                                }
                              } catch (err) {
                                // Safe error logging
                                try {
                                  if (err && typeof err === "object" && Object.keys(err).length > 0) {
                                    console.error("Error clearing flag:", err);
                                  } else {
                                    console.error("Unknown error occurred:", err);
                                  }
                                } catch (logErr) {
                                  console.error("Error occurred but could not be logged:", String(err || "Unknown"));
                                }
                              }
                            })();
                          }}
                          className="mt-1 text-xs px-2 py-1 rounded border border-amber-300 bg-white hover:bg-amber-50 text-amber-800"
                          aria-label="Clear flag (reviewed)"
                        >
                          ✓ Gennemgået - Fjern flag
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {showInvitationButtons && (
                  <div className="mt-2 ml-0 flex gap-2 max-w-[85%] sm:max-w-[75%]">
                    <button
                      type="button"
                      onClick={handleRejectInvitation}
                      disabled={invitationActionId !== null}
                      className="flex-1 rounded-lg border-2 border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 transition"
                    >
                      {invitationActionId === parentInvitation.id ? "…" : "Afvis"}
                    </button>
                    <button
                      type="button"
                      onClick={handleAcceptInvitation}
                      disabled={invitationActionId !== null}
                      className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition shadow-md"
                    >
                      {invitationActionId === parentInvitation.id ? "…" : "Acceptér"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSend}
          className="flex-shrink-0 flex gap-2 p-3 sm:p-4 border-t border-gray-200 bg-gray-50 safe-area-inset-bottom"
        >
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
            className="flex-shrink-0 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Attach image"
            title="Attach image"
          >
            {uploading ? "…" : "📷"}
          </button>
          
          {/* Image picker popup */}
          {showImagePicker && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 bg-black/50 z-40"
                onClick={() => setShowImagePicker(false)}
                aria-hidden="true"
              />
              {/* Popup */}
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
                <div
                  className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
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
                      className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
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
                      className="w-full px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
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
            onChange={(e) => {
              setContent(e.target.value);
              setTyping(true);
            }}
            onBlur={() => setTyping(false)}
            placeholder="Skriv en besked…"
            disabled={sending}
            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 min-h-[44px]"
            aria-label="Message input"
          />
          <button
            type="submit"
            disabled={sending || !content.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none min-h-[44px]"
            aria-label="Send besked"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
