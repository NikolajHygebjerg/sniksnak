"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { initializePushNotifications } from "@/lib/push-notifications";

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

type ChatRead = {
  chat_id: string;
  last_read_at: string;
};

export default function ChatsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [usersById, setUsersById] = useState<Record<string, UserRow>>({});
  const [lastMessageByChat, setLastMessageByChat] = useState<
    Record<string, MessageRow>
  >({});
  const [lastReadByChat, setLastReadByChat] = useState<Record<string, string>>(
    {}
  );
  const [messagesFromOthers, setMessagesFromOthers] = useState<MessageRow[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isChild, setIsChild] = useState(false);
  const [friends, setFriends] = useState<UserRow[]>([]);
  const [storedParentLinks, setStoredParentLinks] = useState<Array<{child_id: string, surveillance_level: string}> | null>(null);
  const [currentUserData, setCurrentUserData] = useState<UserRow | null>(null);
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
          // Always update with the newest message (realtime updates should be newest)
          setLastMessageByChat((prev) => {
            const existing = prev[row.chat_id];
            // Only update if this message is newer than existing
            if (!existing || new Date(row.created_at) > new Date(existing.created_at)) {
              return { ...prev, [row.chat_id]: row };
            }
            return prev;
          });
          if (row.sender_id !== userRef.current) {
            setMessagesFromOthers((prev) => [...prev, row]);
            
            // Send push notification for new message from others
            // Only if user is not currently viewing this chat
            if (typeof window !== 'undefined') {
              const currentPath = window.location.pathname;
              const isViewingThisChat = currentPath === `/chats/${row.chat_id}`;
              
              if (!isViewingThisChat) {
                sendPushNotificationForMessage(row, usersById[row.sender_id]);
              }
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "parent_approved_contacts",
        },
        (payload) => {
          // Friend was added - reload friend list if it's for this child
          const row = payload.new as { child_id: string; contact_user_id: string };
          console.log("Realtime: parent_approved_contacts INSERT", row);
          if (userRef.current && row.child_id === userRef.current) {
            console.log("Reloading friends for child:", userRef.current);
            supabase
              .from("parent_approved_contacts")
              .select("contact_user_id")
              .eq("child_id", userRef.current)
              .then(({ data: approvedRows, error }) => {
                if (error) {
                  console.error("Error reloading approved contacts:", error);
                  return;
                }
                console.log("Reloaded approved contacts:", approvedRows?.length || 0);
                if (approvedRows && approvedRows.length > 0) {
                  const friendIds = approvedRows.map((r: { contact_user_id: string }) => r.contact_user_id).filter((id): id is string => !!id && typeof id === "string");
                  console.log("Reloading friend IDs:", friendIds);
                  if (friendIds.length > 0) {
                    supabase
                      .from("users")
                      .select("id, email, username, first_name, surname, avatar_url")
                      .in("id", friendIds)
                      .then((friendsRes) => {
                        if (friendsRes.data) {
                          console.log("Realtime: Updated friends list:", friendsRes.data.length);
                          setFriends(friendsRes.data as UserRow[]);
                        } else if (friendsRes.error && /avatar_url/i.test(friendsRes.error.message)) {
                          supabase
                            .from("users")
                            .select("id, email, username, first_name, surname")
                            .in("id", friendIds)
                            .then((fallbackRes) => {
                              if (fallbackRes.data) {
                                console.log("Realtime: Updated friends list (fallback):", fallbackRes.data.length);
                                setFriends(fallbackRes.data as UserRow[]);
                              }
                            });
                        } else if (friendsRes.error) {
                          console.error("Error reloading friends:", friendsRes.error);
                        }
                      });
                  } else {
                    setFriends([]);
                  }
                } else {
                  setFriends([]);
                }
              });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Initialize push notifications when user is logged in
  // This runs silently in the background - failures don't affect the app
  useEffect(() => {
    if (!user?.id) return;
    
    // Initialize push notifications (request permission, register service worker, subscribe)
    // Run this asynchronously without blocking or showing errors to user
    initializePushNotifications().catch(() => {
      // Silent fail - push notifications are optional, badge still works
    });
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

      const { data: ownUser, error: ownUserError } = await supabase
        .from("users")
        .select("username, first_name, surname, avatar_url")
        .eq("id", uid)
        .maybeSingle();
      if (ownUserError) {
        // Safe error logging
        try {
          if (ownUserError && typeof ownUserError === "object" && Object.keys(ownUserError).length > 0) {
            console.error("Error loading own user:", ownUserError);
          } else {
            console.error("Unknown error occurred:", ownUserError);
          }
        } catch (logErr) {
          console.error("Error occurred but could not be logged:", String(ownUserError || "Unknown"));
        }
      }
      const isChildUser = !!(ownUser?.username != null && String(ownUser.username).trim() !== "");
      
      // Check if user is a parent
      const { data: parentLinks } = await supabase
        .from("parent_child_links")
        .select("child_id, surveillance_level")
        .eq("parent_id", uid);

      // Redirect parents to /parent (parent chat page)
      if (!cancelled && parentLinks && parentLinks.length > 0 && !isChildUser) {
        router.replace("/parent");
        return;
      }

      if (!cancelled) {
        setIsChild(isChildUser);
        if (ownUser) {
          setCurrentUserData({
            id: uid,
            email: session.user.email || "",
            username: ownUser.username,
            first_name: ownUser.first_name,
            surname: ownUser.surname,
            avatar_url: ownUser.avatar_url,
          });
        }
      }
      
      let chatsData;
      let chatsErr;
      
      // Get all chats where user is a direct participant
      const result = await supabase
        .from("chats")
        .select("id, user1_id, user2_id, created_at")
        .or(`user1_id.eq.${uid},user2_id.eq.${uid}`)
        .order("created_at", { ascending: false });
      chatsData = result.data;
      chatsErr = result.error;

      if (chatsErr) {
        if (!cancelled) {
          console.error("Error loading chats:", chatsErr);
          setError(chatsErr.message);
        }
        setLoading(false);
        return;
      }

      let list = (chatsData ?? []) as Chat[];
      
      // Store parentLinks for later use in filtering and rendering
      if (!cancelled) {
        setStoredParentLinks(parentLinks);
      }
      
      if (!cancelled && isChildUser) {
        try {
          const { data: approvedRows, error: approvedErr } = await supabase
            .from("parent_approved_contacts")
            .select("contact_user_id")
            .eq("child_id", uid);
          
          if (approvedErr) {
            console.error("Error loading approved contacts:", approvedErr);
            if (!cancelled) {
              setFriends([]);
            }
          } else {
            const TALERADGIVEREN_USER_ID = process.env.NEXT_PUBLIC_TALERADGIVEREN_USER_ID || "945d9864-7118-487b-addb-1dd1e821bc30";
            const approvedSet = new Set((approvedRows ?? []).map((r: { contact_user_id: string }) => r.contact_user_id));
            list = list.filter((c) => {
              const otherId = c.user1_id === uid ? c.user2_id : c.user1_id;
              // Always show Talerådgiveren chat, even if not in approved contacts
              if (otherId === TALERADGIVEREN_USER_ID) {
                return true;
              }
              return approvedSet.has(otherId);
            });
            if (!cancelled) {
              setChats(list);
            }
            
            // Load friend list (approved contacts) - always load, even if no chats
            if (!cancelled) {
              console.log("Loading friends for child:", uid, "approvedRows:", approvedRows?.length || 0);
              if (approvedRows && approvedRows.length > 0) {
                const friendIds = approvedRows
                  .map((r: { contact_user_id: string }) => r.contact_user_id)
                  .filter((id): id is string => {
                    // Filter out invalid IDs
                    return !!id && typeof id === "string" && id.trim().length > 0;
                  });
                console.log("Friend IDs to fetch:", friendIds.length, "IDs:", friendIds);
                if (friendIds.length > 0) {
                  // Handle single ID vs multiple IDs - use .eq() for single, .in() for multiple
                  let friendsRes;
                  try {
                    // Filter out any empty or invalid IDs first
                    const validIds = friendIds.filter(id => id && typeof id === "string" && id.trim().length > 0);
                    
                    if (validIds.length === 0) {
                      console.warn("No valid friend IDs after filtering");
                      setFriends([]);
                    } else if (validIds.length === 1) {
                      // Use .eq() for single ID
                      const singleId = validIds[0].trim();
                      console.log("Fetching single friend:", singleId);
                      friendsRes = await supabase
                        .from("users")
                        .select("id, email, username, first_name, surname, avatar_url")
                        .eq("id", singleId)
                        .maybeSingle();
                      
                      // Convert single result to array format
                      if (friendsRes.data) {
                        friendsRes = { ...friendsRes, data: [friendsRes.data] };
                      } else {
                        friendsRes = { ...friendsRes, data: [] };
                      }
                    } else {
                      // Use .in() for multiple IDs
                      console.log("Fetching multiple friends:", validIds.length, "IDs");
                      friendsRes = await supabase
                        .from("users")
                        .select("id, email, username, first_name, surname, avatar_url")
                        .in("id", validIds);
                    }
                    
                    // Check if we have data first - if so, use it and skip error handling
                    const hasData = friendsRes && friendsRes.data && Array.isArray(friendsRes.data) && friendsRes.data.length > 0;
                    
                    if (hasData && friendsRes && friendsRes.data) {
                      // We have data - use it regardless of any error
                      console.log("Loaded friends successfully:", friendsRes.data.length);
                      if (!cancelled) {
                        setFriends(friendsRes.data as UserRow[]);
                      }
                      // Skip all error handling since we have data
                    } else if (friendsRes && friendsRes.error) {
                      // Only handle errors if we don't have data
                      const errorObj = friendsRes.error;
                      
                      // Check if error object is actually empty (no meaningful error)
                      const errorKeys = errorObj && typeof errorObj === "object" ? Object.keys(errorObj) : [];
                      const isEmptyError = errorKeys.length === 0 && typeof errorObj === "object";
                      
                      // Try to extract error information more defensively
                      let errorMsg = "";
                      let errorCode = "";
                      let errorDetails = "";
                      let errorHint = "";
                      
                      try {
                        // Get all keys from the error object
                        if (errorObj && typeof errorObj === "object") {
                          // Try accessing properties directly
                          errorMsg = (errorObj as any)?.message || (errorObj as any)?.msg || "";
                          errorCode = (errorObj as any)?.code || (errorObj as any)?.status || "";
                          errorDetails = (errorObj as any)?.details || "";
                          errorHint = (errorObj as any)?.hint || "";
                        } else if (typeof errorObj === "string") {
                          errorMsg = errorObj;
                        } else {
                          errorMsg = String(errorObj || "Unknown error");
                        }
                      } catch (extractErr) {
                        // Silently handle extraction errors
                        errorMsg = String(errorObj || "Unknown error");
                      }
                      
                      const errorMessageIsEmpty = !errorMsg || errorMsg === "Unknown error" || errorMsg.trim().length === 0;
                      const hasNoMeaningfulError = isEmptyError && errorMessageIsEmpty && !errorCode && !errorDetails && !errorHint;
                      
                      // If error is empty or has no meaningful content, just set empty friends list without logging
                      if (hasNoMeaningfulError) {
                        // Silent failure - just set empty array, no logging
                        if (!cancelled) {
                          setFriends([]);
                        }
                      } else {
                        // Check if we have any meaningful error information
                        const hasMeaningfulInfo = (errorCode && errorCode !== "NO_CODE") || 
                                                  (errorMsg && errorMsg !== "NO_MESSAGE" && errorMsg !== "Unknown error" && errorMsg.trim().length > 0) ||
                                                  (errorDetails && errorDetails.trim().length > 0) || 
                                                  (errorHint && errorHint.trim().length > 0);
                        
                        if (!hasMeaningfulInfo) {
                          // No meaningful error info - silent failure
                          if (!cancelled) {
                            setFriends([]);
                          }
                        } else {
                          // Only log if we have meaningful error information
                          // Build errorInfo only with fields that have actual values
                          const errorInfo: Record<string, any> = {
                            friendIdsLength: friendIds.length,
                            queryType: friendIds.length === 1 ? "single" : "multiple"
                          };
                          
                          // Only add fields that have meaningful content
                          if (errorCode && errorCode !== "NO_CODE" && errorCode.trim().length > 0) {
                            errorInfo.code = errorCode;
                          }
                          if (errorMsg && errorMsg !== "NO_MESSAGE" && errorMsg !== "Unknown error" && errorMsg.trim().length > 0) {
                            errorInfo.message = errorMsg;
                          }
                          if (errorDetails && errorDetails.trim().length > 0) {
                            errorInfo.details = errorDetails;
                          }
                          if (errorHint && errorHint.trim().length > 0) {
                            errorInfo.hint = errorHint;
                          }
                          if (errorKeys.length > 0) {
                            errorInfo.errorKeys = errorKeys;
                          }
                          
                          // Only log if we have at least one meaningful field (beyond friendIdsLength and queryType)
                          const hasAnyMeaningfulField = (errorCode && errorCode !== "NO_CODE" && errorCode.trim().length > 0) || 
                                                       (errorMsg && errorMsg !== "NO_MESSAGE" && errorMsg !== "Unknown error" && errorMsg.trim().length > 0) ||
                                                       (errorDetails && errorDetails.trim().length > 0) ||
                                                       (errorHint && errorHint.trim().length > 0);
                          
                          if (hasAnyMeaningfulField) {
                            // Safe logging - check errorInfo exists before logging
                            try {
                              if (errorInfo && Object.keys(errorInfo).length > 0) {
                                console.error("Error loading friends (first attempt):", errorInfo);
                              } else {
                                console.error("Unknown error occurred:", errorObj);
                              }
                            } catch (logErr) {
                              // If logging fails, use fallback
                              console.error("Error occurred but could not be logged:", String(errorObj || "Unknown"));
                            }
                            
                            // Only log properties if we have keys and meaningful error
                            if (errorKeys.length > 0 && !isEmptyError) {
                              const propertyDetails: Record<string, any> = {};
                              for (const key of errorKeys) {
                                try {
                                  const value = (errorObj as any)[key];
                                  // Only include serializable values that are not empty
                                  if (value !== undefined && value !== null) {
                                    if (typeof value === "string" && value.trim().length > 0) {
                                      propertyDetails[key] = value;
                                    } else if (typeof value === "number" || typeof value === "boolean") {
                                      propertyDetails[key] = value;
                                    } else if (typeof value === "object") {
                                      try {
                                        const serialized = JSON.stringify(value);
                                        if (serialized !== "{}" && serialized !== "[]" && serialized !== "null") {
                                          propertyDetails[key] = value;
                                        }
                                      } catch {
                                        // Skip non-serializable objects
                                      }
                                    }
                                  }
                                } catch (propErr) {
                                  // Skip properties that can't be accessed
                                }
                              }
                              // Only log if we have properties with actual content - safe logging
                              if (propertyDetails && Object.keys(propertyDetails).length > 0) {
                                console.error("Error object properties:", propertyDetails);
                              } else {
                                console.error("Unknown error occurred:", errorObj);
                              }
                            }
                          }
                          
                          // Set empty friends list (regardless of whether we logged)
                          if (!cancelled) {
                            setFriends([]);
                          }
                        }
                      }
                    }
                    
                    // If we still don't have data and there was an error, try fallback: query IDs individually
                    if (!hasData && friendsRes && friendsRes.error && validIds.length > 1) {
                      console.log("Batch query failed, trying individual queries for", validIds.length, "friends");
                      try {
                        const individualResults: UserRow[] = [];
                        for (const friendId of validIds.slice(0, 10)) { // Limit to 10 to avoid too many queries
                          if (cancelled) break;
                          const { data: friendData, error: friendErr } = await supabase
                            .from("users")
                            .select("id, email, username, first_name, surname, avatar_url")
                            .eq("id", friendId)
                            .maybeSingle();
                          
                          if (cancelled) break;
                          
                          if (friendErr) {
                            // Safe error logging
                            try {
                              if (friendErr && typeof friendErr === "object" && Object.keys(friendErr).length > 0) {
                                console.error(`Error loading friend ${friendId}:`, friendErr);
                              }
                            } catch (logErr) {
                              // Skip logging if it fails
                            }
                          } else if (friendData) {
                            individualResults.push(friendData as UserRow);
                          }
                        }
                        
                        if (!cancelled && individualResults.length > 0) {
                          console.log("Loaded friends via individual queries:", individualResults.length);
                          setFriends(individualResults);
                        } else if (!cancelled) {
                          setFriends([]);
                        }
                      } catch (fallbackErr) {
                        // Safe error logging
                        try {
                          if (fallbackErr && typeof fallbackErr === "object" && Object.keys(fallbackErr).length > 0) {
                            console.error("Exception in fallback friend loading:", fallbackErr);
                          } else {
                            console.error("Unknown error occurred:", fallbackErr);
                          }
                        } catch (logErr) {
                          console.error("Error occurred but could not be logged:", String(fallbackErr || "Unknown"));
                        }
                        if (!cancelled) {
                          setFriends([]);
                        }
                      }
                    } else if (!cancelled && friendsRes && friendsRes.data && Array.isArray(friendsRes.data) && friendsRes.data.length > 0) {
                      // We have data from the original query - use it
                      console.log("Loaded friends successfully:", friendsRes.data.length);
                      setFriends(friendsRes.data as UserRow[]);
                    } else if (!hasData && friendsRes && !friendsRes.error && !cancelled) {
                      // No error but no data - set empty array
                      setFriends([]);
                    }
                  } catch (fetchErr) {
                    // Safe error logging
                    try {
                      if (fetchErr && typeof fetchErr === "object" && Object.keys(fetchErr).length > 0) {
                        console.error("Exception while loading friends:", fetchErr);
                      } else {
                        console.error("Unknown error occurred:", fetchErr);
                      }
                    } catch (logErr) {
                      console.error("Error occurred but could not be logged:", String(fetchErr || "Unknown"));
                    }
                    if (!cancelled) {
                      setFriends([]);
                    }
                  }
                } else if (!cancelled) {
                  console.log("No valid friend IDs found");
                  setFriends([]);
                }
              } else if (!cancelled) {
                console.log("No approved contacts found");
                setFriends([]);
              }
            }
          }
        } catch (err) {
          // Safe error logging - always log without crashing
          try {
            if (err && typeof err === "object") {
              console.error("Exception in child user friends loading:", err);
            } else {
              console.error("Unknown error occurred:", err);
            }
          } catch (logErr) {
            // If even logging fails, use a fallback
            console.error("Error occurred but could not be logged:", String(err || "Unknown"));
          }
          if (!cancelled) {
            setFriends([]);
          }
        }
      } else if (!cancelled) {
        // For parents: filter out children's chats, only show parent-to-parent chats
        // Children's chats are accessible via Parent view page
        if (parentLinks && parentLinks.length > 0) {
          console.log("Parent detected, filtering to show only parent-to-parent chats. Parent links:", parentLinks.length);
          console.log("Initial chat list:", list.length);
          
          // Get all child IDs to filter them out
          const childIds = new Set(parentLinks.map(link => link.child_id));
          
          // Filter: exclude chats where either participant is a child
          // Only show chats where both participants are NOT children (i.e., parent-to-parent chats)
          const filteredList = list.filter((c) => {
            const user1IsChild = childIds.has(c.user1_id);
            const user2IsChild = childIds.has(c.user2_id);
            // Show chat only if NEITHER participant is a child
            return !user1IsChild && !user2IsChild;
          });
          
          console.log("Filtered chat list (parent-to-parent only):", filteredList.length);
          setChats(filteredList);
          list = filteredList;
        } else {
          // Not a parent - show all chats (existing behavior for children)
          console.log("Not a parent, showing all chats:", list.length);
          setChats(list);
        }
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
          .order("created_at", { ascending: false }),
        supabase
          .from("messages")
          .select("id, chat_id, sender_id, content, created_at")
          .in("chat_id", chatIds)
          .neq("sender_id", uid),
      ]);

      if (!cancelled && usersRes.data) {
        const map: Record<string, UserRow> = {};
        for (const u of usersRes.data as UserRow[]) {
          map[u.id] = u;
        }
        setUsersById(map);
      }

      if (!cancelled) {
        if (readsRes.data) {
          const byChat: Record<string, string> = {};
          for (const r of readsRes.data as ChatRead[]) {
            byChat[r.chat_id] = r.last_read_at;
          }
          setLastReadByChat(byChat);
        }
        // If chat_reads table doesn't exist yet (migration not run), readsRes.error is set; unread will show all from others
      }

      if (!cancelled && messagesRes.data) {
        const byChat: Record<string, MessageRow> = {};
        // Group messages by chat_id and keep only the most recent one per chat
        for (const m of messagesRes.data as MessageRow[]) {
          const existing = byChat[m.chat_id];
          if (!existing || new Date(m.created_at) > new Date(existing.created_at)) {
            byChat[m.chat_id] = m;
          }
        }
        setLastMessageByChat(byChat);
      }

      if (!cancelled && othersRes.data) {
        setMessagesFromOthers((othersRes.data ?? []) as MessageRow[]);
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

  // Calculate total unread count across all chats
  const totalUnreadCount = useMemo(() => {
    return chats.reduce((total, chat) => total + getUnreadCount(chat.id), 0);
  }, [chats, messagesFromOthers, lastReadByChat]);

  // Function to send push notification for a new message
  async function sendPushNotificationForMessage(
    message: MessageRow,
    sender: UserRow | undefined
  ) {
    try {
      const senderName = otherUserLabel(sender);
      const messagePreview = message.content 
        ? (message.content.length > 50 ? message.content.slice(0, 50) + "..." : message.content)
        : "Ny besked";

      // Call backend API to send push notification
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      await fetch("/api/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          title: `Ny besked fra ${senderName}`,
          body: messagePreview,
          chatId: message.chat_id,
          url: `/chats/${message.chat_id}`,
          tag: `chat-${message.chat_id}`,
        }),
      });
    } catch (error) {
      console.error("Error sending push notification:", error);
      // Don't show error to user - push notifications are optional
    }
  }

  // Sort chats by last message timestamp (most recent first)
  // Always shows chats with newest messages at the top
  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const lastMsgA = lastMessageByChat[a.id];
      const lastMsgB = lastMessageByChat[b.id];
      
      // If both have messages, sort by message timestamp (newest first)
      if (lastMsgA && lastMsgB) {
        const timeA = new Date(lastMsgA.created_at).getTime();
        const timeB = new Date(lastMsgB.created_at).getTime();
        return timeB - timeA; // Newest first
      }
      
      // If only one has messages, prioritize it (chats with messages go to top)
      if (lastMsgA && !lastMsgB) return -1;
      if (!lastMsgA && lastMsgB) return 1;
      
      // If neither has messages, sort by chat creation date (newest first)
      const chatTimeA = new Date(a.created_at).getTime();
      const chatTimeB = new Date(b.created_at).getTime();
      return chatTimeB - chatTimeA; // Newest first
    });
  }, [chats, lastMessageByChat]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <main
        className="min-h-screen flex items-center justify-center p-4 sm:p-6"
        role="status"
        aria-label="Indlæser chats"
      >
        <p className="text-gray-500">Indlæser…</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen flex flex-col safe-area-inset bg-[#C4E6CA] pb-20" style={{ fontFamily: 'Arial, sans-serif' }}>
      <div className="max-w-2xl mx-auto w-full flex flex-col min-h-0 px-4 py-6">
        {/* Logo */}
        <div className="flex-shrink-0 flex justify-center mb-4">
          <Image src="/logo.svg" alt="Sniksnak Chat" width={156} height={156} className="w-[156px] h-[156px]" />
        </div>

        {/* Current User Avatar and First Name - Only for children */}
        {isChild && currentUserData && (
          <div className="flex-shrink-0 flex flex-col items-center mb-6">
            {currentUserData.avatar_url ? (
              <img
                src={currentUserData.avatar_url}
                alt={`${currentUserData.first_name || currentUserData.username || 'User'}'s avatar`}
                className="h-[83px] w-[83px] rounded-full object-cover bg-gray-200 mb-2"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const fallback = target.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <span
              className={`h-[83px] w-[83px] rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-2xl font-medium mb-2 ${currentUserData.avatar_url ? 'hidden' : ''}`}
              aria-hidden="true"
            >
              {(currentUserData.first_name || currentUserData.username || 'U')[0].toUpperCase()}
            </span>
            <span className="text-lg font-semibold text-gray-900" style={{ fontFamily: 'Arial, sans-serif' }}>
              {currentUserData.first_name || currentUserData.username || 'User'}
            </span>
          </div>
        )}

        {/* Header for parents */}
        {!isChild && (
          <header className="flex-shrink-0 flex flex-wrap items-center justify-between gap-3 mb-4">
            <h1 className="text-2xl font-semibold" style={{ fontFamily: 'Arial, sans-serif' }}>Chats</h1>
            <Link
              href="/parent"
              className="text-sm font-medium text-gray-600 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 rounded-lg px-2 py-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
              aria-label="Forældrevisning"
            >
              Forældrevisning
            </Link>
          </header>
        )}

        {error && (
          <p className="mb-4 text-sm text-red-600" role="alert" style={{ fontFamily: 'Arial, sans-serif' }}>
            {error}
          </p>
        )}

        {/* Chat List Box - Only for children */}
        {isChild ? (
          chats.length === 0 ? (
            <section
              className="rounded-3xl border border-gray-200 bg-white p-6 sm:p-8 text-center flex-1 flex flex-col items-center justify-center min-h-[400px]"
              aria-label="No Chat-friends yet"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              <p className="text-lg font-medium text-gray-800 mb-2" style={{ fontFamily: 'Arial, sans-serif' }}>Du har ingen chat-venner endnu</p>
              <p className="text-gray-500 mb-4 max-w-sm" style={{ fontFamily: 'Arial, sans-serif' }}>
                Forbind med andre børn ved at søge efter deres navn eller ved at sende dem en invitation til at deltage i appen.
              </p>
              <Link
                href="/chats/new"
                className="inline-block rounded-lg bg-[#E0785B] px-4 py-3 text-sm font-medium text-white hover:bg-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 min-h-[44px] inline-flex items-center justify-center"
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                Find chat-venner
              </Link>
            </section>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <ul
                className="rounded-3xl border border-gray-200 bg-[#E2F5E6] flex-1 min-h-0 overflow-y-auto"
                role="list"
                aria-label="Chat list"
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
            {sortedChats.map((chat) => {
              // Determine the other user in the chat
              // For parents viewing children's chats, show the other child (not their own child)
              let otherId: string;
              if (chat.user1_id === user.id || chat.user2_id === user.id) {
                // User is direct participant
                otherId = chat.user1_id === user.id ? chat.user2_id : chat.user1_id;
              } else if (storedParentLinks && storedParentLinks.length > 0) {
                // User is a parent viewing a child's chat
                const childIds = new Set(storedParentLinks.map(link => link.child_id));
                if (childIds.has(chat.user1_id)) {
                  otherId = chat.user2_id; // Show the other child
                } else if (childIds.has(chat.user2_id)) {
                  otherId = chat.user1_id; // Show the other child
                } else {
                  // Fallback
                  otherId = chat.user1_id === user.id ? chat.user2_id : chat.user1_id;
                }
              } else {
                // Fallback
                otherId = chat.user1_id === user.id ? chat.user2_id : chat.user1_id;
              }
              const other = usersById[otherId];
              const label = otherUserLabel(other);
              const lastMsg = lastMessageByChat[chat.id];
              const unread = getUnreadCount(chat.id);
              const preview = lastMsg
                ? lastMsg.content?.trim() || "Vedhæftet fil"
                : "Ingen beskeder endnu";

              // Get first name for display
              const firstName = other?.first_name?.trim() || other?.username?.trim() || label;

              return (
                <li key={chat.id} role="listitem" className="border-b border-gray-200 last:border-b-0">
                  <Link
                    href={`/chats/${chat.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#E0785B] transition touch-manipulation"
                    aria-label={`Chat with ${firstName}${unread > 0 ? `, ${unread} unread` : ""}`}
                  >
                    {/* Other child's avatar */}
                    {other?.avatar_url ? (
                      <img 
                        src={other.avatar_url} 
                        alt={`${firstName}'s avatar`} 
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
                      className={`h-12 w-12 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-base font-medium ${other?.avatar_url ? 'hidden' : ''}`}
                      aria-hidden="true"
                      style={{ fontFamily: 'Arial, sans-serif' }}
                    >
                      {firstName[0].toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="mb-1">
                        <span className="font-bold text-gray-900 truncate block" style={{ fontFamily: 'Arial, sans-serif' }}>
                          {firstName}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 truncate" style={{ fontFamily: 'Arial, sans-serif', fontWeight: 'normal' }}>
                        {preview}
                      </p>
                    </div>
                    {unread > 0 && (
                      <span
                        className="flex-shrink-0 rounded-full bg-[#E0785B] text-white text-xs font-medium min-w-[22px] h-[22px] inline-flex items-center justify-center px-1.5"
                        aria-label={`${unread} unread`}
                        style={{ fontFamily: 'Arial, sans-serif' }}
                      >
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
              </ul>
            </div>
          )
        ) : (
          /* Parent view - keep original layout */
          chats.length === 0 ? (
            <section
              className="rounded-xl border border-gray-200 bg-[#E2F5E6] p-6 sm:p-8 text-center flex-1 flex flex-col items-center justify-center"
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
              className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-[#E2F5E6] flex-1 min-h-0 overflow-auto"
              role="list"
              aria-label="Chat list"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              {sortedChats.map((chat) => {
                let otherId: string;
                if (chat.user1_id === user.id || chat.user2_id === user.id) {
                  otherId = chat.user1_id === user.id ? chat.user2_id : chat.user1_id;
                } else if (storedParentLinks && storedParentLinks.length > 0) {
                  const childIds = new Set(storedParentLinks.map(link => link.child_id));
                  if (childIds.has(chat.user1_id)) {
                    otherId = chat.user2_id;
                  } else if (childIds.has(chat.user2_id)) {
                    otherId = chat.user1_id;
                  } else {
                    otherId = chat.user1_id === user.id ? chat.user2_id : chat.user1_id;
                  }
                } else {
                  otherId = chat.user1_id === user.id ? chat.user2_id : chat.user1_id;
                }
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
                          style={{ fontFamily: 'Arial, sans-serif' }}
                        >
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        )}

      </div>

      {/* Bottom Navigation Bar - Only for children */}
      {isChild && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom z-50">
          <div className="max-w-2xl mx-auto flex items-center justify-around px-2 py-1">
            <Link
              href="/chats"
              className={`relative flex flex-col items-center justify-center px-2 py-1 min-h-[48px] min-w-[48px] rounded-lg transition-colors ${
                isActive("/chats") ? "text-[#E0785B]" : "text-gray-400"
              }`}
              aria-label={`Chat${totalUnreadCount > 0 ? `, ${totalUnreadCount} ulæste` : ""}`}
            >
              <Image src="/chaticon.svg" alt="" width={48} height={48} className="w-12 h-12" />
              {totalUnreadCount > 0 && (
                <span
                  className="absolute top-1 right-1 flex-shrink-0 rounded-full bg-red-500 text-white text-xs font-bold min-w-[20px] h-5 inline-flex items-center justify-center px-1.5 border-2 border-white"
                  aria-label={`${totalUnreadCount} ulæste beskeder`}
                >
                  {totalUnreadCount > 99 ? "99+" : totalUnreadCount}
                </span>
              )}
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
    </main>
  );
}
