"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface UnreadBadgeProps {
  userId: string | null;
}

export default function UnreadBadge({ userId }: UnreadBadgeProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [chats, setChats] = useState<Array<{ id: string }>>([]);
  const [lastReadByChat, setLastReadByChat] = useState<Record<string, string>>({});
  const [messagesFromOthers, setMessagesFromOthers] = useState<Array<{
    chat_id: string;
    created_at: string;
  }>>([]);
  const chatIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      setChats([]);
      setLastReadByChat({});
      setMessagesFromOthers([]);
      return;
    }

    let cancelled = false;

    async function loadUnreadCount() {
      // Get all chats for user (both direct chats and group chats)
      // First get direct chats
      const { data: directChatsData } = await supabase
        .from("chats")
        .select("id, user1_id, user2_id, group_id")
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
        .is("group_id", null);

      if (cancelled) return;

      // Get group chats where user is a member or creator
      const { data: groupMemberships } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", userId);

      if (cancelled) return;

      // Also include groups created by this user (in case membership is missing)
      const { data: createdGroups } = await supabase
        .from("groups")
        .select("id")
        .eq("created_by", userId);

      if (cancelled) return;

      const membershipGroupIds = (groupMemberships || []).map((m) => m.group_id);
      const createdGroupIds = (createdGroups || []).map((g) => g.id);
      const allGroupIds = Array.from(new Set([...membershipGroupIds, ...createdGroupIds]));

      let groupChatsData: any[] = [];
      if (allGroupIds.length > 0) {
        const { data: groupChats } = await supabase
          .from("chats")
          .select("id, group_id")
          .in("group_id", allGroupIds);

        if (cancelled) return;
        groupChatsData = groupChats || [];
      }

      // Combine direct chats and group chats
      const allChats = [
        ...(directChatsData || []),
        ...groupChatsData
      ];

      if (allChats.length === 0) {
        setChats([]);
        setLastReadByChat({});
        setMessagesFromOthers([]);
        setUnreadCount(0);
        return;
      }

      const chatList = allChats.map((c) => ({ id: c.id }));
      setChats(chatList);
      chatIdsRef.current = new Set(chatList.map((c) => c.id));

      const chatIds = chatList.map((c) => c.id);

      // Get last read timestamps
      const { data: readsData } = await supabase
        .from("chat_reads")
        .select("chat_id, last_read_at")
        .eq("user_id", userId)
        .in("chat_id", chatIds);

      if (cancelled) return;

      const lastReadMap: Record<string, string> = {};
      if (readsData) {
        for (const r of readsData) {
          lastReadMap[r.chat_id] = r.last_read_at;
        }
      }
      setLastReadByChat(lastReadMap);

      // Get messages from others (only the ones we need to check)
      // Limit to reasonable number to avoid performance issues
      const { data: messagesData } = await supabase
        .from("messages")
        .select("id, chat_id, sender_id, created_at")
        .in("chat_id", chatIds)
        .neq("sender_id", userId)
        .order("created_at", { ascending: false })
        .limit(1000); // Limit to prevent performance issues

      if (cancelled) return;

      if (messagesData) {
        // Deduplicate messages by chat_id and created_at to avoid double counting
        const uniqueMessages = messagesData.reduce((acc: Array<{ chat_id: string; created_at: string }>, msg) => {
          const key = `${msg.chat_id}-${msg.created_at}`;
          if (!acc.find(m => `${m.chat_id}-${m.created_at}` === key)) {
            acc.push({ chat_id: msg.chat_id, created_at: msg.created_at });
          }
          return acc;
        }, []);
        setMessagesFromOthers(uniqueMessages);
      } else {
        setMessagesFromOthers([]);
      }
    }

    loadUnreadCount();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`unread-badge-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const row = payload.new as { chat_id: string; sender_id: string; created_at: string };
          // Only process if it's a chat we're tracking and from someone else
          if (chatIdsRef.current.has(row.chat_id) && row.sender_id !== userId) {
            setMessagesFromOthers((prev) => {
              // Check if message already exists
              if (prev.some((m) => m.chat_id === row.chat_id && m.created_at === row.created_at)) {
                return prev;
              }
              return [...prev, { chat_id: row.chat_id, created_at: row.created_at }];
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_reads",
        },
        (payload) => {
          const row = payload.new as { chat_id: string; user_id: string; last_read_at: string };
          if (row.user_id === userId && chatIdsRef.current.has(row.chat_id)) {
            setLastReadByChat((prev) => ({
              ...prev,
              [row.chat_id]: row.last_read_at,
            }));
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_reads",
        },
        (payload) => {
          const row = payload.new as { chat_id: string; user_id: string; last_read_at: string };
          if (row.user_id === userId && chatIdsRef.current.has(row.chat_id)) {
            setLastReadByChat((prev) => ({
              ...prev,
              [row.chat_id]: row.last_read_at,
            }));
          }
        }
      )
      .subscribe();

    // Poll as a fallback to keep counts correct
    const pollInterval = setInterval(() => {
      loadUnreadCount();
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Calculate unread count using same logic as chats page
  useEffect(() => {
    function getUnreadCount(chatId: string): number {
      const lastRead = lastReadByChat[chatId];
      if (!lastRead) {
        return messagesFromOthers.filter((m) => m.chat_id === chatId).length;
      }
      return messagesFromOthers.filter(
        (m) => m.chat_id === chatId && m.created_at > lastRead
      ).length;
    }

    const total = chats.reduce((sum, chat) => sum + getUnreadCount(chat.id), 0);
    setUnreadCount(total);
  }, [chats, messagesFromOthers, lastReadByChat]);

  if (unreadCount === 0) return null;

  return (
    <span
      className="absolute top-1 right-1 flex-shrink-0 rounded-full bg-red-500 text-white text-xs font-bold min-w-[20px] h-5 inline-flex items-center justify-center px-1.5 border-2 border-white z-10"
      aria-label={`${unreadCount} ulæste beskeder`}
    >
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  );
}
