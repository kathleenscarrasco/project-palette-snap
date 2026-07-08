import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isLocalDevAuth, supabase } from "@/integrations/supabase/client";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isAuthed: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

const localDevUser = {
  id: "local-dev-user",
  email: "local-dev@fotofairy.test",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date(0).toISOString(),
} as User;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!isLocalDevAuth);

  useEffect(() => {
    if (isLocalDevAuth) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      console.log("[auth] state change:", event, s?.user?.email ?? null);
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error("[auth] getSession error:", error);
      console.log("[auth] initial session:", data.session?.user?.email ?? null);
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    if (isLocalDevAuth) return;
    const { error } = await supabase.auth.signOut();
    if (error) console.error("[auth] signOut error:", error);
  };

  return (
    <Ctx.Provider
      value={{
        session,
        user: isLocalDevAuth ? localDevUser : (session?.user ?? null),
        loading,
        isAuthed: isLocalDevAuth || !!session,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
