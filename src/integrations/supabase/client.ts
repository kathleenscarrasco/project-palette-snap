import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xqrwpcchhaygkrxgwrig.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxcndwY2NoaGF5Z2tyeGd3cmlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDcyNTUsImV4cCI6MjA5NzM4MzI1NX0.nhl9j9Ii-gAFm94NqSR3KypBAPvtggbCiPx-SCZGCCk";

export type SavedProject = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: string;
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});
