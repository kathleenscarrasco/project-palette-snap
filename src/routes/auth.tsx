import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { isAuthed, setBypass } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthed) navigate({ to: "/" });
  }, [isAuthed, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function bypass() {
    setBypass(true);
    toast.success("Auth bypassed — for testing only");
    navigate({ to: "/" });
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-coral/30 blur-3xl animate-blob" />
      <div className="pointer-events-none absolute -right-16 top-60 h-80 w-80 rounded-full bg-lavender/40 blur-3xl animate-blob" style={{ animationDelay: "-5s" }} />

      <div className="mx-auto max-w-sm">
        <Link to="/" className="flex items-center gap-2">
          <BrandMark className="h-9 w-9" />
          <BrandWordmark size="text-xl" />
        </Link>

        <div className="glass-card mt-8 rounded-3xl p-6">
          <h1 className="font-display text-3xl">{mode === "signin" ? "Welcome back" : "Create account"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to keep curating." : "Sign up to start curating."}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full rounded-xl border border-ink/10 bg-white px-4 text-sm outline-none focus:border-coral"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-xl border border-ink/10 bg-white px-4 text-sm outline-none focus:border-coral"
            />
            <button
              type="submit"
              disabled={busy}
              className="h-12 w-full rounded-xl bg-ink font-semibold text-cream transition hover:bg-coral disabled:opacity-50"
            >
              {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-center text-xs text-muted-foreground underline"
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-ink/20 p-4 text-center">
          <p className="text-xs text-muted-foreground">Just testing the app?</p>
          <button
            type="button"
            onClick={bypass}
            className="mt-2 text-sm font-semibold text-coral underline"
          >
            Skip sign-in (bypass)
          </button>
        </div>
      </div>
    </main>
  );
}
