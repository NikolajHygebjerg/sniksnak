"use client";

/**
 * Parent dashboard: list of linked children from parent_child_links.
 * Parents see children they are linked to; clicking a child goes to that child's chat list.
 * Children cannot access this page (blocked by account type).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type LinkRow = {
  id: number;
  parent_id: string;
  child_id: string;
  surveillance_level?: string | null;
};

type UserRow = {
  id: string;
  email: string;
  username?: string | null;
  first_name?: string | null;
  surname?: string | null;
  avatar_url?: string | null;
};

export default function ParentPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [usersById, setUsersById] = useState<Record<string, UserRow>>({});
  const [friendsByChildId, setFriendsByChildId] = useState<Record<string, UserRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [usernameColumnMissing, setUsernameColumnMissing] = useState(false);
  const [firstnameSurnameColumnMissing, setFirstnameSurnameColumnMissing] = useState(false);
  // Create child form (first name + surname + PIN + photo + surveillance level)
  const [createFirstName, setCreateFirstName] = useState("");
  const [createSurname, setCreateSurname] = useState("");
  const [createPin, setCreatePin] = useState("");
  const [createSurveillanceLevel, setCreateSurveillanceLevel] = useState<"strict" | "medium" | "mild">("medium");
  const [createPhotoFile, setCreatePhotoFile] = useState<File | null>(null);
  const [createPhotoPreview, setCreatePhotoPreview] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createMessage, setCreateMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [nameTaken, setNameTaken] = useState(false);
  const [duplicateNameSuffix, setDuplicateNameSuffix] = useState("");
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  // Link existing child by email (secondary)
  const [linkEmail, setLinkEmail] = useState("");
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [linkMessage, setLinkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showLinkByEmail, setShowLinkByEmail] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [accessDenied, setAccessDenied] = useState(false);
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);
  const [updatingSurveillanceLevel, setUpdatingSurveillanceLevel] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<Array<{
    id: string;
    child_id: string;
    contact_user_id: string;
    child_name: string;
    contact_name: string;
    chat_id?: string | null;
  }>>([]);
  
  async function handleUpdateSurveillanceLevel(childId: string, newLevel: "strict" | "medium" | "mild") {
    if (!user || updatingSurveillanceLevel) return;
    
    setUpdatingSurveillanceLevel(childId);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setUpdatingSurveillanceLevel(null);
      return;
    }
    
    try {
      const res = await fetch("/api/parent/update-surveillance-level", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ childId, surveillanceLevel: newLevel }),
      });
      
      const data = await res.json();
      if (!res.ok) {
        console.error("Error updating surveillance level:", data.error, data.details);
        // Show error to user
        setError(`Failed to update surveillance level: ${data.error}${data.details ? ` (${data.details})` : ""}`);
        return;
      }
      
      // Refresh the links to show updated surveillance level
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error("Error updating surveillance level:", error);
    } finally {
      setUpdatingSurveillanceLevel(null);
    }
  }

  // Block children and redirect; parents go straight to dashboard
  useEffect(() => {
    let cancelled = false;

    async function checkAccessAndLoad() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        
        if (!session?.user) {
          if (!cancelled) router.replace("/login");
          return;
        }
        if (!cancelled) setUser(session.user);
        const uid = session.user.id;

      // Child accounts have username set; they must NOT see parent view
      const { data: ownUser, error: ownUserError } = await supabase
        .from("users")
        .select("username")
        .eq("id", uid)
        .maybeSingle();

      if (cancelled) return;

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

      if (!cancelled && ownUser?.username != null && String(ownUser.username).trim() !== "") {
        setAccessDenied(true);
        setLoading(false);
        router.replace("/chats");
        return;
      }

      // Parent: load links and children (including surveillance_level)
      const { data: linksData, error: linksErr } = await supabase
        .from("parent_child_links")
        .select("id, parent_id, child_id, surveillance_level")
        .eq("parent_id", uid)
        .order("id", { ascending: true });

      if (linksErr) {
        if (!cancelled) {
          setError(linksErr.message);
          setSchemaMissing(
            /parent_child_links|schema cache|does not exist|relation .* does not exist/i.test(
              linksErr.message
            )
          );
        }
        setLoading(false);
        return;
      }

      const list = (linksData ?? []) as LinkRow[];
      if (!cancelled) setLinks(list);

      if (list.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      const childIds = [...new Set(list.map((l) => l.child_id))];
      let usersData: UserRow[] | null = null;
      let usersErr: { message: string } | null = null;
      const { data: usersDataWithUsername, error: usersErrWithUsername } = await supabase
        .from("users")
        .select("id, email, username, first_name, surname, avatar_url")
        .in("id", childIds);

      if (usersErrWithUsername && /avatar_url|column.*does not exist/i.test(usersErrWithUsername.message) && !/first_name|surname/i.test(usersErrWithUsername.message)) {
        // avatar_url column missing (migration 006 not run); load without it
        const { data: fallbackAvatar } = await supabase
          .from("users")
          .select("id, email, username, first_name, surname")
          .in("id", childIds);
        
        if (cancelled) return;
        
        if (!cancelled && fallbackAvatar) {
          usersData = fallbackAvatar as UserRow[];
        } else {
          usersErr = usersErrWithUsername;
        }
      } else if (usersErrWithUsername && /first_name|surname|column.*does not exist/i.test(usersErrWithUsername.message)) {
        if (!cancelled) setFirstnameSurnameColumnMissing(true);
        setError(usersErrWithUsername.message);
      } else if (usersErrWithUsername && /username|schema cache/i.test(usersErrWithUsername.message)) {
        if (!cancelled) setUsernameColumnMissing(true);
        const { data: fallback } = await supabase
          .from("users")
          .select("id, email")
          .in("id", childIds);
        
        if (cancelled) return;
        
        usersData = fallback as UserRow[] | null;
      } else if (usersErrWithUsername) {
        usersErr = usersErrWithUsername;
      } else {
        usersData = usersDataWithUsername as UserRow[] | null;
      }

      if (!cancelled && usersData) {
        const map: Record<string, UserRow> = {};
        for (const u of usersData) {
          map[u.id] = u;
        }
        setUsersById(map);
      }

      // Load friends (approved contacts) for each child
      if (!cancelled && childIds.length > 0) {
        try {
          const { data: approvedRows, error: approvedError } = await supabase
            .from("parent_approved_contacts")
            .select("child_id, contact_user_id")
            .in("child_id", childIds);
          
          if (cancelled) return;

          if (approvedError) {
            // Safe error logging
            try {
              if (approvedError && typeof approvedError === "object" && Object.keys(approvedError).length > 0) {
                console.error("Error loading approved contacts:", approvedError);
              } else {
                console.error("Unknown error occurred:", approvedError);
              }
            } catch (logErr) {
              console.error("Error occurred but could not be logged:", String(approvedError || "Unknown"));
            }
          }
          
          if (!cancelled && approvedRows) {
            const friendIdsByChild: Record<string, string[]> = {};
            for (const row of approvedRows as { child_id: string; contact_user_id: string }[]) {
              if (!friendIdsByChild[row.child_id]) friendIdsByChild[row.child_id] = [];
              friendIdsByChild[row.child_id].push(row.contact_user_id);
            }
            
            const allFriendIds = [...new Set(Object.values(friendIdsByChild).flat())].filter((id): id is string => !!id && typeof id === "string");
            if (allFriendIds.length > 0) {
              try {
                let friendsRes = await supabase
                  .from("users")
                  .select("id, email, username, first_name, surname, avatar_url")
                  .in("id", allFriendIds);
                
                if (cancelled) return;

                if (friendsRes.error && /avatar_url|column.*does not exist/i.test(friendsRes.error.message)) {
                  const fallbackRes = await supabase
                    .from("users")
                    .select("id, email, username, first_name, surname")
                    .in("id", allFriendIds);
                  if (fallbackRes.data) {
                    friendsRes = {
                      ...fallbackRes,
                      data: fallbackRes.data.map((u: any) => ({ ...u, avatar_url: null })),
                    } as any as typeof friendsRes;
                  } else {
                    friendsRes = fallbackRes as any as typeof friendsRes;
                  }
                }
                
                if (cancelled) return;
                
                // Add avatar_url if missing from query result
                if (friendsRes.data) {
                  friendsRes = {
                    ...friendsRes,
                    data: friendsRes.data.map((u: any) => ({
                      ...u,
                      avatar_url: u.avatar_url ?? null,
                    })),
                  } as typeof friendsRes;
                }
                
                if (!cancelled && friendsRes.data) {
                  const friendsMap: Record<string, UserRow[]> = {};
                  for (const childId of childIds) {
                    const friendIds = friendIdsByChild[childId] || [];
                    friendsMap[childId] = (friendsRes.data as UserRow[]).filter((f) => friendIds.includes(f.id));
                  }
                  setFriendsByChildId(friendsMap);
                } else if (!cancelled && friendsRes.error) {
                  // Safe error logging
                  try {
                    if (friendsRes.error && typeof friendsRes.error === "object" && Object.keys(friendsRes.error).length > 0) {
                      console.error("Failed to load friends:", friendsRes.error);
                    } else {
                      console.error("Unknown error occurred:", friendsRes.error);
                    }
                  } catch (logErr) {
                    console.error("Error occurred but could not be logged:", String(friendsRes.error || "Unknown"));
                  }
                }
              } catch (err) {
                // Safe error logging
                try {
                  if (err && typeof err === "object" && Object.keys(err).length > 0) {
                    console.error("Exception loading friends:", err);
                  } else {
                    console.error("Unknown error occurred:", err);
                  }
                } catch (logErr) {
                  console.error("Error occurred but could not be logged:", String(err || "Unknown"));
                }
              }
            }
          }
        } catch (err) {
          // Safe error logging for outer try block
          try {
            if (err && typeof err === "object" && Object.keys(err).length > 0) {
              console.error("Exception in friends loading:", err);
            } else {
              console.error("Unknown error occurred:", err);
            }
          } catch (logErr) {
            console.error("Error occurred but could not be logged:", String(err || "Unknown"));
          }
        }
      }

      // Load pending contact requests for this parent's children
      if (!cancelled && childIds.length > 0) {
        try {
          const { data: pendingRows, error: pendingError } = await supabase
            .from("pending_contact_requests")
            .select("id, child_id, contact_user_id")
            .in("child_id", childIds);
          
          if (cancelled) return;
          
          if (pendingError) {
            // Safe error logging
            try {
              if (pendingError && typeof pendingError === "object" && Object.keys(pendingError).length > 0) {
                console.error("Error loading pending requests:", pendingError);
              } else {
                console.error("Unknown error occurred:", pendingError);
              }
            } catch (logErr) {
              console.error("Error occurred but could not be logged:", String(pendingError || "Unknown"));
            }
          } else if (!cancelled && pendingRows && pendingRows.length > 0) {
            // Get names for children and contacts
            const allUserIds = [...new Set([
              ...pendingRows.map((r: { child_id: string }) => r.child_id),
              ...pendingRows.map((r: { contact_user_id: string }) => r.contact_user_id)
            ])];
            
            const { data: userNames, error: userNamesError } = await supabase
              .from("users")
              .select("id, first_name, surname, username, email")
              .in("id", allUserIds);
            
            if (cancelled) return;
            
            // Load parent_invitation_chats to get chat_id for each request
            // Query for invitations where inviting_child_id is one of our children
            const { data: invitationChats, error: invitationChatsError } = await supabase
              .from("parent_invitation_chats")
              .select("chat_id, inviting_child_id, invited_child_id")
              .in("inviting_child_id", childIds);
            
            if (cancelled) return;
            
            // Create a map from (inviting_child_id, invited_child_id) to chat_id
            const chatIdMap: Record<string, string> = {};
            if (!invitationChatsError && invitationChats) {
              for (const inv of invitationChats) {
                const key = `${inv.inviting_child_id}-${inv.invited_child_id}`;
                chatIdMap[key] = inv.chat_id;
              }
            }
            
            if (!userNamesError && userNames) {
              const nameMap: Record<string, string> = {};
              for (const u of userNames) {
                const name = (u.first_name && u.surname) 
                  ? `${u.first_name.trim()} ${u.surname.trim()}`
                  : (u.username?.trim() || u.email || "Unknown");
                nameMap[u.id] = name;
              }
              
              const formattedRequests = pendingRows.map((req: { id: string; child_id: string; contact_user_id: string }) => {
                const key = `${req.child_id}-${req.contact_user_id}`;
                return {
                  id: req.id,
                  child_id: req.child_id,
                  contact_user_id: req.contact_user_id,
                  child_name: nameMap[req.child_id] || "Unknown child",
                  contact_name: nameMap[req.contact_user_id] || "Unknown contact",
                  chat_id: chatIdMap[key] || null
                };
              });
              
              if (!cancelled) setPendingRequests(formattedRequests);
            }
          } else if (!cancelled) {
            setPendingRequests([]);
          }
        } catch (err) {
          // Safe error logging
          try {
            if (err && typeof err === "object" && Object.keys(err).length > 0) {
              console.error("Exception loading pending requests:", err);
            } else {
              console.error("Unknown error occurred:", err);
            }
          } catch (logErr) {
            console.error("Error occurred but could not be logged:", String(err || "Unknown"));
          }
        }
      }

      if (!cancelled && usersErr) setError(usersErr.message);
      if (!cancelled) setLoading(false);
    } catch (err) {
        // Handle AbortError and other exceptions
        if (cancelled) return;
        
        // Check if it's an AbortError (operation was aborted)
        if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
          console.log("Operation was aborted (component unmounted or navigation occurred)");
          return;
        }
        
        // Safe error logging for other errors
        try {
          if (err && typeof err === "object" && Object.keys(err).length > 0) {
            console.error("Error in checkAccessAndLoad:", err);
          } else {
            console.error("Unknown error occurred:", err);
          }
        } catch (logErr) {
          console.error("Error occurred but could not be logged:", String(err || "Unknown"));
        }
        
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "An error occurred while loading");
          setLoading(false);
        }
      }
    }

    checkAccessAndLoad();
    return () => {
      cancelled = true;
    };
  }, [router, refreshKey]);

  /** Create a child account (first name + surname + PIN). Child can only use the app if parent creates them. */
  async function handleCreateChild(e: React.FormEvent, suggested?: { first_name: string; surname: string }) {
    e.preventDefault();
    if (!user || createSubmitting) return;
    const first_name = (suggested?.first_name ?? createFirstName).trim();
    const surname = (suggested?.surname ?? createSurname).trim();
    const pin = createPin.trim();
    if (!first_name || !surname) {
      setCreateMessage({ type: "error", text: "Enter both first name and surname." });
      return;
    }
    if (first_name.length < 2) {
      setCreateMessage({ type: "error", text: "First name must be at least 2 characters." });
      return;
    }
    if (surname.length < 2) {
      setCreateMessage({ type: "error", text: "Surname must be at least 2 characters." });
      return;
    }
    const anonymousNames = ["incognito", "anonymous", "anon", "unknown", "hidden", "secret", "nickname", "fake", "test", "demo"];
    if (anonymousNames.includes(first_name.toLowerCase()) || anonymousNames.includes(surname.toLowerCase())) {
      setCreateMessage({ type: "error", text: "Use your child's real first name and surname." });
      return;
    }
    if (pin.length < 4 || pin.length > 12) {
      setCreateMessage({ type: "error", text: "PIN must be 4–12 characters." });
      return;
    }
    if (!createPhotoFile || !createPhotoFile.type.startsWith("image/")) {
      setCreateMessage({ type: "error", text: "A photo of your child is required. Please upload a clear photo of your child for security." });
      return;
    }
    setCreateSubmitting(true);
    setCreateMessage(null);
    setNameTaken(false);
    setDuplicateNameSuffix("");
    setInvitationLink(null);
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setCreateSubmitting(false);
      setCreateMessage({ type: "error", text: "Session expired. Please log in again." });
      return;
    }
    const formData = new FormData();
    formData.set("first_name", first_name);
    formData.set("surname", surname);
    formData.set("pin", pin);
    formData.set("surveillance_level", createSurveillanceLevel);
    formData.set("photo", createPhotoFile);
    const res = await fetch("/api/parent/create-child", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    setCreateSubmitting(false);
    if (!res.ok) {
      if (res.status === 409 && data.code === "NAME_TAKEN") {
        setNameTaken(true);
        setDuplicateNameSuffix("");
        setCreateMessage({ type: "error", text: data.error ?? "This name is already in use. Add a city, number, or nickname in the box below and click Accept." });
      } else {
        const detail = data.detail ? ` (${data.detail})` : "";
        setCreateMessage({ type: "error", text: (data.error ?? "Failed to create child account.") + detail });
      }
      return;
    }
    setCreateFirstName("");
    setCreateSurname("");
    setCreatePin("");
    setCreatePhotoFile(null);
    if (createPhotoPreview) URL.revokeObjectURL(createPhotoPreview);
    setCreatePhotoPreview(null);
    setNameTaken(false);
    setDuplicateNameSuffix("");
    if (data.invitationLink) {
      setInvitationLink(data.invitationLink);
      setCreateMessage({ type: "success", text: `${data.displayName ?? first_name + " " + surname} is set up. Share the invitation link below with your child.` });
    } else {
      setCreateMessage({ type: "success", text: `${data.displayName ?? first_name + " " + surname} can log in at Child login with their full name and PIN.` });
    }
    setRefreshKey((k) => k + 1);
  }

  /** Link an existing user (by email) as a child. RLS allows insert where parent_id = me. */
  async function handleLinkChild(e: React.FormEvent) {
    e.preventDefault();
    if (!user || linkSubmitting) return;
    const email = linkEmail.trim().toLowerCase();
    if (!email) {
      setLinkMessage({ type: "error", text: "Enter the child's email." });
      return;
    }
    setLinkSubmitting(true);
    setLinkMessage(null);
    setError(null);

    const { data: childUser, error: userErr } = await supabase
      .from("users")
      .select("id, email")
      .ilike("email", email)
      .maybeSingle();

    if (userErr || !childUser) {
      setLinkSubmitting(false);
      setLinkMessage({ type: "error", text: "No account found with that email." });
      return;
    }

    if (childUser.id === user.id) {
      setLinkSubmitting(false);
      setLinkMessage({ type: "error", text: "You cannot link yourself as a child." });
      return;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("parent_child_links")
      .insert({ parent_id: user.id, child_id: childUser.id })
      .select("id, parent_id, child_id")
      .single();

    setLinkSubmitting(false);
    if (insertErr) {
      if (insertErr.code === "23505") {
        setLinkMessage({ type: "error", text: "This child is already linked." });
      } else {
        setLinkMessage({ type: "error", text: insertErr.message });
      }
      return;
    }

    setLinkEmail("");
    setLinkMessage({ type: "success", text: `${childUser.email} is now linked as a child.` });
    setLinks((prev) => [...prev, inserted as LinkRow]);
    setUsersById((prev) => ({ ...prev, [childUser.id]: childUser as UserRow }));
  }

  /** Delete/unlink a child */
  async function handleDeleteChild(childId: string, childName: string) {
    if (!user) return;
    if (!confirm(`Are you sure you want to delete the account for ${childName}? This will remove your connection to this child, but their account will remain.`)) {
      return;
    }
    setDeletingChildId(childId);
    setError(null);

    // Find the link to delete
    const linkToDelete = links.find((l) => l.child_id === childId);
    if (!linkToDelete) {
      setDeletingChildId(null);
      setError("Link not found");
      return;
    }

    const { error: deleteErr } = await supabase
      .from("parent_child_links")
      .delete()
      .eq("id", linkToDelete.id)
      .eq("parent_id", user.id); // Extra safety check

    setDeletingChildId(null);
    if (deleteErr) {
      setError(deleteErr.message);
      return;
    }

    // Remove from local state
    setLinks((prev) => prev.filter((l) => l.id !== linkToDelete.id));
    setUsersById((prev) => {
      const updated = { ...prev };
      delete updated[childId];
      return updated;
    });
    setFriendsByChildId((prev) => {
      const updated = { ...prev };
      delete updated[childId];
      return updated;
    });
  }

  // Child account: redirect in progress
  if (accessDenied) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-500">You don&apos;t have access to the parent view. Redirecting…</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" role="status" aria-label="Loading">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen p-4 sm:p-6 safe-area-inset">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold">Parent view</h1>
          <nav className="flex items-center gap-4">
            <Link
              href="/chats"
              className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-3 py-2 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              Chat
            </Link>
          </nav>
        </header>

        {error && !firstnameSurnameColumnMissing && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert">
            <p className="text-sm font-medium text-amber-800">Setup required</p>
            {schemaMissing ? (
              <>
                <p className="mt-1 text-sm text-amber-700">
                  The <code className="rounded bg-amber-100 px-1">parent_child_links</code> table
                  does not exist yet. Run the Phase 6 migration in your Supabase project.
                </p>
                <ol className="mt-3 list-decimal list-inside space-y-1 text-sm text-amber-800">
                  <li>Open Supabase Dashboard → SQL Editor</li>
                  <li>Paste and run the contents of <code className="rounded bg-amber-100 px-1">supabase/migrations/003_phase6_parent_controls.sql</code></li>
                  <li>Refresh this page</li>
                </ol>
                <p className="mt-2 text-xs text-amber-600">
                  Raw error: {error}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-red-600">{error}</p>
            )}
          </div>
        )}

        {firstnameSurnameColumnMissing && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert">
            <p className="text-sm font-medium text-amber-800">Setup required: add first name and surname</p>
            <p className="mt-1 text-sm text-amber-700">
              The <code className="rounded bg-amber-100 px-1">users</code> table is missing the <code className="rounded bg-amber-100 px-1">first_name</code> and <code className="rounded bg-amber-100 px-1">surname</code> columns. Run migration 005 in your Supabase project.
            </p>
            <ol className="mt-3 list-decimal list-inside space-y-1 text-sm text-amber-800">
              <li>Open Supabase Dashboard → SQL Editor → New query</li>
              <li>Paste and run the contents of <code className="rounded bg-amber-100 px-1">supabase/migrations/005_child_firstname_surname.sql</code></li>
              <li>Refresh this page</li>
            </ol>
            <p className="mt-2 text-xs text-amber-600">
              Raw error: {error}
            </p>
          </div>
        )}

        {usernameColumnMissing && !error && !firstnameSurnameColumnMissing && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert">
            <p className="text-sm font-medium text-amber-800">Add child names (username column)</p>
            <p className="mt-1 text-sm text-amber-700">
              The <code className="rounded bg-amber-100 px-1">username</code> column is missing on <code className="rounded bg-amber-100 px-1">users</code>.
              Run this in Supabase Dashboard → SQL Editor so child accounts use real names:
            </p>
            <ol className="mt-3 list-decimal list-inside space-y-1 text-sm text-amber-800">
              <li>Open Supabase Dashboard → SQL Editor → New query</li>
              <li>Paste and run the contents of <code className="rounded bg-amber-100 px-1">supabase/migrations/004_child_username.sql</code></li>
              <li>Refresh this page</li>
            </ol>
          </div>
        )}

        <p className="text-gray-500 text-sm mb-4">
          Linked children. Click a child to see their chats and messages (read-only). When another child wants to connect, you&apos;ll get a chat from their parent — open Chats to see it and accept or reject there.
        </p>

        {/* Pending friend requests section */}
        {pendingRequests.length > 0 && (
          <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-6 mb-6" aria-label="Pending friend requests">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Pending friend requests</h2>
            <div className="space-y-2">
              {pendingRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-blue-200">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">{req.child_name}</span> wants to be friends with <span className="font-medium">{req.contact_name}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {req.chat_id ? (
                      <Link
                        href={`/chats/${req.chat_id}`}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        View in Chats →
                      </Link>
                    ) : (
                      <Link
                        href="/chats"
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        View in Chats →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Primary: create a child account (first name + surname + PIN). Child can only use app if parent creates them. */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 mb-6" aria-label="Create a child account">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Create a child account</h2>
          <p className="text-sm text-gray-500 mb-3">
            Your child can only use the app after you create their account. Use their <strong>real first name and surname</strong> so they can&apos;t chat anonymously.
          </p>
          <form onSubmit={(e) => handleCreateChild(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="parent-create-firstname" className="block text-sm font-medium text-gray-700 mb-1">
                  First name
                </label>
                <input
                  id="parent-create-firstname"
                  type="text"
                  value={createFirstName}
                  onChange={(e) => setCreateFirstName(e.target.value)}
                  placeholder="e.g. Alex"
                  disabled={createSubmitting}
                  autoComplete="given-name"
                  minLength={2}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>
              <div>
                <label htmlFor="parent-create-surname" className="block text-sm font-medium text-gray-700 mb-1">
                  Surname
                </label>
                <input
                  id="parent-create-surname"
                  type="text"
                  value={createSurname}
                  onChange={(e) => setCreateSurname(e.target.value)}
                  placeholder="e.g. Jensen"
                  disabled={createSubmitting}
                  autoComplete="family-name"
                  minLength={2}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Use your child&apos;s real first name and surname. Anonymous or fake names are not allowed.
            </p>
            <div>
              <label htmlFor="parent-create-photo" className="block text-sm font-medium text-gray-700 mb-1">
                Photo of your child <span className="text-red-600">(required)</span>
              </label>
              <p className="text-xs text-gray-500 mb-2">
                This must be a clear photo of your child for security. It will be visible to other users they chat with.
              </p>
              <input
                id="parent-create-photo"
                type="file"
                accept="image/*"
                capture="user"
                required
                disabled={createSubmitting}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.type.startsWith("image/")) {
                    if (createPhotoPreview) URL.revokeObjectURL(createPhotoPreview);
                    setCreatePhotoFile(file);
                    setCreatePhotoPreview(URL.createObjectURL(file));
                    setCreateMessage(null);
                  } else if (file) {
                    setCreateMessage({ type: "error", text: "Please choose an image file (e.g. JPEG or PNG)." });
                  }
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700"
              />
              {createPhotoPreview && (
                <div className="mt-2">
                  <img
                    src={createPhotoPreview}
                    alt="Child photo preview"
                    className="h-24 w-24 rounded-full object-cover border-2 border-gray-200"
                  />
                </div>
              )}
            </div>
            <div>
              <label htmlFor="parent-create-pin" className="block text-sm font-medium text-gray-700 mb-1">
                PIN (4–12 characters; child will use this to log in)
              </label>
              <input
                id="parent-create-pin"
                type="password"
                value={createPin}
                onChange={(e) => setCreatePin(e.target.value)}
                placeholder="••••"
                disabled={createSubmitting}
                minLength={4}
                maxLength={12}
                required
                autoComplete="off"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>
            {nameTaken && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900 mb-1">We require your child&apos;s real name for security</p>
                <p className="text-sm text-amber-800 mb-3">
                  Another account already has this name. Keep the real first name and surname above, and add a <strong>city name</strong>, <strong>number</strong>, or <strong>nickname</strong> in the box below to make it unique (e.g. Copenhagen, 2, or AJ).
                </p>
                <label htmlFor="parent-duplicate-suffix" className="block text-sm font-medium text-amber-800 mb-1">
                  City, number, or nickname to add after the surname
                </label>
                <div className="flex flex-wrap gap-2 items-end">
                  <input
                    id="parent-duplicate-suffix"
                    type="text"
                    value={duplicateNameSuffix}
                    onChange={(e) => {
                      setDuplicateNameSuffix(e.target.value);
                      setCreateMessage(null);
                    }}
                    placeholder="e.g. Copenhagen, 2, or AJ"
                    disabled={createSubmitting}
                    className="flex-1 min-w-[160px] rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:bg-gray-100"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      const suffix = duplicateNameSuffix.trim();
                      if (!suffix) {
                        setCreateMessage({ type: "error", text: "Enter a city name, number, or nickname in the box above." });
                        return;
                      }
                      if (!createPhotoFile) {
                        setCreateMessage({ type: "error", text: "A photo of your child is required." });
                        return;
                      }
                      const surnameWithSuffix = `${createSurname.trim()} ${suffix}`;
                      handleCreateChild(e, { first_name: createFirstName.trim(), surname: surnameWithSuffix });
                    }}
                    disabled={createSubmitting || !createPhotoFile}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50"
                    title={!createPhotoFile ? "Upload a photo first" : undefined}
                  >
                    Accept and create
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Surveillance level
              </label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="surveillance_level"
                    value="strict"
                    checked={createSurveillanceLevel === "strict"}
                    onChange={(e) => setCreateSurveillanceLevel(e.target.value as "strict")}
                    disabled={createSubmitting}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900">Strict</div>
                    <div className="text-xs text-gray-600">Access to your child's chats and pictures</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="surveillance_level"
                    value="medium"
                    checked={createSurveillanceLevel === "medium"}
                    onChange={(e) => setCreateSurveillanceLevel(e.target.value as "medium")}
                    disabled={createSubmitting}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900">Medium</div>
                    <div className="text-xs text-gray-600">Notifications when explicit language is used (and then access to the chat)</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="surveillance_level"
                    value="mild"
                    checked={createSurveillanceLevel === "mild"}
                    onChange={(e) => setCreateSurveillanceLevel(e.target.value as "mild")}
                    disabled={createSubmitting}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900">Mild</div>
                    <div className="text-xs text-gray-600">Only receive messages when your child flags a bad message</div>
                  </div>
                </label>
              </div>
            </div>
            <button
              type="submit"
              disabled={createSubmitting || !createPhotoFile}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createSubmitting ? "Creating…" : "Create child account"}
            </button>
          </form>
          {invitationLink && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
              <p className="text-sm font-medium text-green-800 mb-2">Invitation link for your child</p>
              <p className="text-xs text-green-700 mb-2">
                Share this link with your child. They open it, enter their PIN, and can start using the app.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={invitationLink}
                  className="flex-1 rounded border border-green-300 bg-white px-2 py-1.5 text-sm text-gray-800"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(invitationLink);
                    setCreateMessage({ type: "success", text: "Link copied to clipboard." });
                  }}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  Copy link
                </button>
              </div>
            </div>
          )}
          {createMessage && (
            <p
              className={`mt-2 text-sm ${createMessage.type === "success" ? "text-green-600" : "text-red-600"}`}
              role="status"
            >
              {createMessage.text}
            </p>
          )}

          <p className="mt-4 text-sm text-gray-500">
            <button
              type="button"
              onClick={() => setShowLinkByEmail(!showLinkByEmail)}
              className="text-blue-600 hover:underline"
            >
              {showLinkByEmail ? "Hide" : "Link an existing account by email"}
            </button>
          </p>
          {showLinkByEmail && (
            <form onSubmit={handleLinkChild} className="mt-3 flex flex-wrap items-end gap-2 pt-3 border-t border-gray-100">
              <label htmlFor="parent-link-email" className="sr-only">
                Child&apos;s email
              </label>
              <input
                id="parent-link-email"
                type="email"
                value={linkEmail}
                onChange={(e) => setLinkEmail(e.target.value)}
                placeholder="child@example.com"
                disabled={linkSubmitting}
                className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
              />
              <button
                type="submit"
                disabled={linkSubmitting}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {linkSubmitting ? "Linking…" : "Link by email"}
              </button>
            </form>
          )}
          {showLinkByEmail && linkMessage && (
            <p
              className={`mt-2 text-sm ${linkMessage.type === "success" ? "text-green-600" : "text-red-600"}`}
              role="status"
            >
              {linkMessage.text}
            </p>
          )}
        </section>

        {links.length === 0 ? (
          <section className="rounded-xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-500 mb-2">No children yet.</p>
            <p className="text-sm text-gray-400">
              Create a child account above (username + PIN). They can then log in on the Child login page.
            </p>
          </section>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white" role="list">
            {links.map((link) => {
              const child = usersById[link.child_id];
              const label =
                child?.first_name && child?.surname
                  ? `${child.first_name} ${child.surname}`
                  : child?.username ?? child?.email ?? link.child_id;
              const friends = friendsByChildId[link.child_id] || [];
              const friendLabel = (f: UserRow) =>
                f.first_name && f.surname ? `${f.first_name} ${f.surname}` : f.username ?? f.email ?? "Unknown";
              const surveillanceLevel: "strict" | "medium" | "mild" = (link.surveillance_level as "strict" | "medium" | "mild") || "medium";
              const canViewChats = surveillanceLevel === "strict";
              
              return (
                <li key={link.id} role="listitem" className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {canViewChats ? (
                      <Link
                        href={`/parent/children/${link.child_id}`}
                        className="flex items-center gap-3 min-w-0 flex-1 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 transition rounded-lg -mx-2 px-2"
                        aria-label={`View chats for ${label}`}
                      >
                        {child?.avatar_url ? (
                          <img
                            src={child.avatar_url}
                            alt=""
                            className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-gray-200"
                          />
                        ) : (
                          <span className="h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium" aria-hidden>
                            {label.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">{label}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              surveillanceLevel === "strict" ? "bg-red-100 text-red-700" :
                              surveillanceLevel === "medium" ? "bg-yellow-100 text-yellow-700" :
                              surveillanceLevel === "mild" ? "bg-green-100 text-green-700" :
                              "bg-gray-100 text-gray-700"
                            }`}>
                              {surveillanceLevel === "strict" ? "Strict" :
                               surveillanceLevel === "medium" ? "Medium" :
                               surveillanceLevel === "mild" ? "Mild" : "Unknown"}
                            </span>
                          </div>
                        </div>
                        <span className="text-sm text-gray-500 flex-shrink-0 ml-auto">View chats →</span>
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {child?.avatar_url ? (
                          <img
                            src={child.avatar_url}
                            alt=""
                            className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-gray-200"
                          />
                        ) : (
                          <span className="h-10 w-10 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium" aria-hidden>
                            {label.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">{label}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              (surveillanceLevel as string) === "strict" ? "bg-red-100 text-red-700" :
                              (surveillanceLevel as string) === "medium" ? "bg-yellow-100 text-yellow-700" :
                              (surveillanceLevel as string) === "mild" ? "bg-green-100 text-green-700" :
                              "bg-gray-100 text-gray-700"
                            }`}>
                              {(surveillanceLevel as string) === "strict" ? "Strict" :
                               (surveillanceLevel as string) === "medium" ? "Medium" :
                               (surveillanceLevel as string) === "mild" ? "Mild" : "Unknown"}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {(surveillanceLevel as string) === "strict" 
                              ? "Full access to chats and pictures"
                              : (surveillanceLevel as string) === "medium" 
                              ? "Access only after keyword notification"
                              : (surveillanceLevel as string) === "mild"
                              ? "Access only when child flags a message"
                              : "Unknown surveillance level"}
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <select
                        value={surveillanceLevel}
                        onChange={(e) => {
                          const newLevel = e.target.value as "strict" | "medium" | "mild";
                          handleUpdateSurveillanceLevel(link.child_id, newLevel);
                        }}
                        disabled={updatingSurveillanceLevel === link.child_id}
                        className="text-xs rounded-lg border border-gray-300 bg-white px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        aria-label={`Change surveillance level for ${label}`}
                      >
                        <option value="strict">Strict</option>
                        <option value="medium">Medium</option>
                        <option value="mild">Mild</option>
                      </select>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDeleteChild(link.child_id, label);
                        }}
                        disabled={deletingChildId === link.child_id}
                        className="flex-shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`Delete account for ${label}`}
                        title={`Delete account for ${label}`}
                      >
                        {deletingChildId === link.child_id ? "Deleting…" : "Delete account"}
                      </button>
                    </div>
                  </div>
                  {friends.length > 0 && (
                    <div className="mt-2 ml-[52px]">
                      <p className="text-xs text-gray-500 mb-1.5">Friends ({friends.length}):</p>
                      <div className="flex flex-wrap gap-1.5">
                        {friends.map((friend) => (
                          <div
                            key={friend.id}
                            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1"
                          >
                            {friend.avatar_url ? (
                              <img src={friend.avatar_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                            ) : (
                              <span className="h-4 w-4 rounded-full bg-gray-300 flex items-center justify-center text-[10px] font-medium text-gray-600">
                                {friendLabel(friend).slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span className="text-xs font-medium text-gray-700">{friendLabel(friend)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
