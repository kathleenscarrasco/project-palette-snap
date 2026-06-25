import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const BYPASS_KEY = "dumpify-auth-bypass";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  bypassed: boolean;
  isAuthed: boolean;
  setBypass: (v: boolean) => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [bypassed, setBypassed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBypassed(window.localStorage.getItem(BYPASS_KEY) === "1");
    }
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const setBypass = (v: boolean) => {
    if (typeof window !== "undefined") {
      if (v) window.localStorage.setItem(BYPASS_KEY, "1");
      else window.localStorage.removeItem(BYPASS_KEY);
    }
    setBypassed(v);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setBypass(false);
  };

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        bypassed,
        isAuthed: !!session || bypassed,
        setBypass,
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
