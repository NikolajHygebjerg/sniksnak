"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
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
  const userRef = useRef<string | null>(null);
  const chatIdsRef = useRef<Set<string>>(new Set());

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

      const { data: ownUser, error: ownUserError } = await supabase.from("users").select("username").eq("id", uid).maybeSingle();
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
      if (!cancelled) {
        setIsChild(isChildUser);
      }

      // Check if user is a parent
      const { data: parentLinks } = await supabase
        .from("parent_child_links")
        .select("child_id, surveillance_level")
        .eq("parent_id", uid);
      
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
            const approvedSet = new Set((approvedRows ?? []).map((r: { contact_user_id: string }) => r.contact_user_id));
            list = list.filter((c) => {
              const otherId = c.user1_id === uid ? c.user2_id : c.user1_id;
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
        for (const m of messagesRes.data as MessageRow[]) {
          if (!byChat[m.chat_id]) byChat[m.chat_id] = m;
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

  // Sort chats by last message timestamp (most recent first)
  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const lastMsgA = lastMessageByChat[a.id];
      const lastMsgB = lastMessageByChat[b.id];
      
      // If both have messages, sort by message timestamp (newest first)
      if (lastMsgA && lastMsgB) {
        return new Date(lastMsgB.created_at).getTime() - new Date(lastMsgA.created_at).getTime();
      }
      
      // If only one has messages, prioritize it
      if (lastMsgA && !lastMsgB) return -1;
      if (!lastMsgA && lastMsgB) return 1;
      
      // If neither has messages, sort by chat creation date (newest first)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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
        aria-label="Loading chats"
      >
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col safe-area-inset">
      <div className="max-w-2xl mx-auto w-full flex flex-col min-h-0">
        <header className="flex-shrink-0 flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold">Chats</h1>
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            <span className="text-sm text-gray-500 truncate max-w-[140px] sm:max-w-none" title={user.email ?? undefined}>
              {user.email}
            </span>
            {!isChild && (
              <Link
                href="/parent"
                className="text-sm font-medium text-gray-600 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg px-2 py-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
                aria-label="Parent view"
              >
                Parent view
              </Link>
            )}
            <Link
              href="/chats/new"
              className="text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg px-2 py-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
              aria-label="Find Chat-friends"
            >
              Find Chat-friends
            </Link>
            {isChild && (
              <Link
                href="/groups"
                className="text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg px-2 py-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
                aria-label="Groups"
              >
                Grupper
              </Link>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded px-2 py-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
              aria-label="Log out"
            >
              Log out
            </button>
          </div>
        </header>

        {error && (
          <p className="mb-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {isChild && (
          <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4" aria-label="Friends">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              My Friends {friends.length > 0 && `(${friends.length})`}
            </h2>
            {friends.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {friends.map((friend) => {
                  const label = otherUserLabel(friend);
                  return (
                    <div
                      key={friend.id}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                    >
                      {/* AVATAR VISNING FOR VENNER */}
                      {/* Hvis vennen har uploadet et avatar-billede (avatar_url findes), vises det */}
                      {friend.avatar_url ? (
                        <img 
                          src={friend.avatar_url} 
                          alt={`${label}'s avatar`} 
                          className="h-6 w-6 rounded-full object-cover bg-gray-200"
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
                        className={`h-6 w-6 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-600 ${friend.avatar_url ? 'hidden' : ''}`}
                        aria-hidden="true"
                      >
                        {label.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="text-sm font-medium text-gray-800">{label}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No friends yet. Your parent needs to approve connections first.</p>
            )}
          </section>
        )}

        {chats.length === 0 ? (
          <section
            className="rounded-xl border border-gray-200 bg-gray-50 p-6 sm:p-8 text-center flex-1 flex flex-col items-center justify-center"
            aria-label={isChild ? "No Chat-friends yet" : "No chats"}
          >
            {isChild ? (
              <>
                <p className="text-lg font-medium text-gray-800 mb-2">You have no Chat-friends yet</p>
                <p className="text-gray-500 mb-4 max-w-sm">
                  Connect with other children by searching for their name or by sending them an invite to join the app.
                </p>
                <Link
                  href="/chats/new"
                  className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 min-h-[44px] inline-flex items-center justify-center"
                >
                  Find Chat-friends
                </Link>
              </>
            ) : (
              <>
                <p className="text-lg font-medium text-gray-800 mb-2">No chats yet</p>
                <p className="text-gray-500 mb-4 max-w-sm">
                  Your chats with other parents will appear here. You&apos;ll receive a chat when another parent&apos;s child wants to connect with your child.
                </p>
              </>
            )}
          </section>
        ) : (
          <ul
            className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white flex-1 min-h-0 overflow-auto"
            role="list"
            aria-label="Chat list"
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
                ? lastMsg.content?.trim() || "Attachment"
                : "No messages yet";

              return (
                <li key={chat.id} role="listitem">
                  <Link
                    href={`/chats/${chat.id}`}
                    className="flex items-center gap-3 sm:gap-4 px-4 py-3 sm:py-3.5 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 transition touch-manipulation"
                    aria-label={`Chat with ${label}${unread > 0 ? `, ${unread} unread` : ""}`}
                  >
                    {/* AVATAR VISNING I CHATLISTEN */}
                    {/* Hvis den anden bruger har uploadet et avatar-billede (avatar_url findes), vises det */}
                    {other?.avatar_url ? (
                      <img 
                        src={other.avatar_url} 
                        alt={`${label}'s avatar`} 
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
                      className={`h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium ${other?.avatar_url ? 'hidden' : ''}`}
                      aria-hidden="true"
                    >
                      {label.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 truncate">
                          {label}
                        </span>
                        <span className="text-sm text-gray-500 flex-shrink-0">
                          {dateStr}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 truncate mt-0.5">
                        {preview}
                      </p>
                    </div>
                    {unread > 0 && (
                      <span
                        className="flex-shrink-0 rounded-full bg-blue-600 text-white text-xs font-medium min-w-[22px] h-[22px] inline-flex items-center justify-center px-1.5"
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

        <p className="mt-4 sm:mt-6">
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded px-1 py-0.5"
          >
            ← Home
          </Link>
        </p>
      </div>
    </main>
  );
}
