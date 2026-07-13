import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ndkgjxkkqwffddrkjbxv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qihsQCXeQUSOZdVMha8B4w_U8cE52vB";
export const isLocalDevAuth =
  import.meta.env.DEV && import.meta.env.VITE_DUMPDECK_DEV_AUTH === "true";

export type SavedProject = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at?: string | null;
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});
