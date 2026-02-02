import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Supabase client for the browser.
 * Use this in Client Components (e.g. login, chat).
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
