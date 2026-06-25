import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthed) navigate({ to: "/projects" });
  }, [isAuthed, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        console.log("[auth] signUp result:", data.user?.id, "session:", !!data.session);
        // If email confirmation is enabled on the project, signUp won't return a session.
        // Immediately try to sign in so dev flow works without the confirmation email.
        if (!data.session) {
          const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
          if (signInErr) throw signInErr;
        }
        toast.success("Welcome!");
        navigate({ to: "/projects" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
        navigate({ to: "/projects" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      console.error("[auth] error:", err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-coral/30 blur-3xl animate-blob" />
      <div className="pointer-events-none absolute -right-16 top-60 h-80 w-80 rounded-full bg-lavender/40 blur-3xl animate-blob" style={{ animationDelay: "-5s" }} />

      <div className="mx-auto w-full max-w-sm">
        <Link to="/" className="flex items-center gap-2">
          <BrandMark className="h-9 w-9" />
          <BrandWordmark size="text-xl" />
        </Link>

        <div className="glass-card mt-8 rounded-3xl p-6 sm:p-7">
          <h1 className="font-display text-3xl">{mode === "signin" ? "Welcome back" : "Create account"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to keep curating." : "Sign up — we'll log you in straight away."}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="h-12 w-full rounded-xl border border-ink/10 bg-white px-4 text-base outline-none focus:border-coral disabled:opacity-60"
            />
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="Password (min 6 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              className="h-12 w-full rounded-xl border border-ink/10 bg-white px-4 text-base outline-none focus:border-coral disabled:opacity-60"
            />

            {error && (
              <div className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink font-semibold text-cream transition hover:bg-coral disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => { setError(null); setMode(mode === "signin" ? "signup" : "signin"); }}
            className="mt-4 w-full text-center text-xs text-muted-foreground underline"
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}
