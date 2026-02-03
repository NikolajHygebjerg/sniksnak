"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export default function NewGroupPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [isChild, setIsChild] = useState(false);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setAvatar(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setShowImagePicker(false);
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

  useEffect(() => {
    async function loadUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        const { data: userData } = await supabase
          .from("users")
          .select("is_child")
          .eq("id", session.user.id)
          .maybeSingle();
        setIsChild(userData?.is_child ?? false);
      }
    }
    loadUser();
  }, []);

  const isActive = (path: string) => pathname === path;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !name.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("No session token");
        setSubmitting(false);
        return;
      }

      const formData = new FormData();
      formData.append("name", name.trim());
      if (avatar) {
        formData.append("avatar", avatar);
      }

      const res = await fetch("/api/groups/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create group");
        setSubmitting(false);
        return;
      }

      // Redirect to group page
      router.push(`/groups/${data.group.id}`);
    } catch (err) {
      console.error("Error creating group:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 safe-area-inset bg-[#C4E6CA] pb-20">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center gap-4 mb-6">
          <Link
            href="/groups"
            className="text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#E0785B] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center touch-manipulation"
            aria-label="Tilbage til grupper"
          >
            ← Grupper
          </Link>
          <h1 className="text-xl sm:text-2xl font-semibold">Opret ny gruppe</h1>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-[#E2F5E6] p-4 sm:p-6 space-y-4">
          <div>
            <label htmlFor="group-name" className="block text-sm font-medium text-gray-700 mb-2">
              Gruppens navn
            </label>
            <input
              id="group-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="f.eks. Fodboldholdet"
              disabled={submitting}
              required
              minLength={1}
              maxLength={50}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:border-[#E0785B] focus:outline-none focus:ring-1 focus:ring-[#E0785B] disabled:bg-gray-100 min-h-[44px]"
            />
            <p className="mt-1 text-xs text-gray-500">Maksimalt 50 tegn</p>
          </div>

          {/* Avatar upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Gruppens billede (valgfrit)
            </label>
            <div className="flex items-center gap-4">
              {avatarPreview ? (
                <div className="relative">
                  <img
                    src={avatarPreview}
                    alt="Preview"
                    className="h-20 w-20 rounded-full object-cover border-2 border-gray-300"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setAvatar(null);
                      setAvatarPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                      if (cameraInputRef.current) cameraInputRef.current.value = "";
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                    aria-label="Remove avatar"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenImagePicker}
                  className="h-20 w-20 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-[#E0785B] hover:text-[#E0785B] focus:outline-none focus:ring-2 focus:ring-[#E0785B] transition-colors"
                  aria-label="Add group avatar"
                >
                  📷
                </button>
              )}
              <div className="flex-1">
                <p className="text-sm text-gray-600">
                  {avatarPreview ? "Billede valgt" : "Tilføj et billede til gruppen"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Vælg fra fotoapp eller tag et nyt billede
                </p>
              </div>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
              aria-label="Select image from gallery"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleAvatarChange}
              aria-label="Take photo with camera"
            />
          </div>

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
                      className="w-full px-4 py-3 text-center font-medium text-gray-700 hover:bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E0785B] transition-colors min-h-[44px]"
                    >
                      Annuller
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <Link
              href="/groups"
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-[#E2F5E6] focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 disabled:opacity-50 min-h-[44px] inline-flex items-center justify-center"
            >
              Annuller
            </Link>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="flex-1 rounded-lg bg-[#E0785B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#D06A4F] focus:outline-none focus:ring-2 focus:ring-[#E0785B] focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none min-h-[44px]"
            >
              {submitting ? "Opretter…" : "Opret gruppe"}
            </button>
          </div>
        </form>
      </div>

      {/* Bottom Navigation Bar - Only for children */}
      {isChild && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom z-50">
          <div className="max-w-2xl mx-auto flex items-center justify-around px-2 py-2">
            <Link
              href="/chats"
              className={`flex flex-col items-center justify-center px-3 py-2 min-h-[60px] min-w-[60px] rounded-lg transition-colors ${
                isActive("/chats") ? "text-[#E0785B]" : "text-gray-400"
              }`}
              aria-label="Chat"
            >
              <Image src="/chaticon.svg" alt="" width={48} height={48} className="w-12 h-12" />
            </Link>
            <Link
              href="/groups"
              className={`flex flex-col items-center justify-center px-3 py-2 min-h-[60px] min-w-[60px] rounded-lg transition-colors ${
                isActive("/groups") ? "text-[#E0785B]" : "text-gray-400"
              }`}
              aria-label="Grupper"
            >
              <Image src="/groupsicon.svg" alt="" width={67} height={67} className="w-[67px] h-[67px]" />
            </Link>
            <Link
              href="/chats/new"
              className={`flex flex-col items-center justify-center px-3 py-2 min-h-[60px] min-w-[60px] rounded-lg transition-colors ${
                isActive("/chats/new") ? "text-[#E0785B]" : "text-gray-400"
              }`}
              aria-label="Find venner"
            >
              <Image src="/findfriends.svg" alt="" width={48} height={48} className="w-12 h-12" />
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="flex flex-col items-center justify-center px-3 py-2 min-h-[60px] min-w-[60px] rounded-lg transition-colors text-gray-400 hover:text-[#E0785B] focus:outline-none focus:ring-2 focus:ring-[#E0785B]"
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
