import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client with service role (bypasses RLS).
 * Use only in API routes or server components; never expose to the client.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const errorMsg = `Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL=${!!url}, SUPABASE_SERVICE_ROLE_KEY=${!!key}`;
    console.error("⚠️", errorMsg);
    throw new Error(errorMsg);
  }
  try {
    return createClient(url, key);
  } catch (err) {
    console.error("⚠️ Failed to create Supabase service role client:", err);
    throw err;
  }
}
