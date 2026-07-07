import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { isLocalDevAuth, supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";

export const Route = createFileRoute("/auth")({
  errorComponent: AuthError,
  component: AuthPage,
});

function AuthError({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-5 text-center">
      <div className="max-w-sm">
        <h1 className="font-display text-3xl">Sign-in hit a snag</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Try again, or head back to your projects if you are already signed in.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="chip bg-ink text-cream">
            Try again
          </button>
          <Link to="/projects" className="chip">
            Projects
          </Link>
        </div>
      </div>
    </main>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  const [mode, setMode] = useState<AuthMode>(() => initialMode());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthed) return;
    if (mode === "reset") return;
    if (mode === "verified") {
      setNotice("Email confirmed. Opening your projects…");
      window.setTimeout(() => void navigate({ to: "/projects", replace: true }), 900);
      return;
    }
    void navigate({ to: "/projects", replace: true });
  }, [isAuthed, mode, navigate]);

  if (isLocalDevAuth) {
    return (
      <main className="grid min-h-screen place-items-center px-5 text-center">
        <div className="max-w-sm">
          <BrandMark className="mx-auto h-12 w-12" />
          <h1 className="mt-4 font-display text-3xl">Local dev mode is active</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You are signed in as a local-only test user. Production auth is unchanged.
          </p>
          <Link
            to="/projects"
            className="mt-5 inline-flex h-11 items-center rounded-xl bg-ink px-4 font-semibold text-cream"
          >
            Open projects
          </Link>
        </div>
      </main>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "reset") {
        const nextPassword = newPassword || password;
        const { error } = await supabase.auth.updateUser({ password: nextPassword });
        if (error) throw error;
        toast.success("Password updated");
        await navigate({ to: "/projects", replace: true });
        return;
      }

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectUrl("reset"),
        });
        if (error) throw error;
        setMode("check-email");
        setNotice("We sent a password reset link to your email.");
        return;
      }

      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: authRedirectUrl("verified") },
        });
        if (error) throw error;
        setMode("check-email");
        setNotice("We sent a magic sign-in link to your email.");
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authRedirectUrl("verified") },
        });
        if (error) throw error;
        console.log("[auth] signUp result:", data.user?.id, "session:", !!data.session);
        if (!data.session) {
          setMode("check-email");
          setNotice("Check your email to confirm your DumpDeck account.");
          return;
        }
        toast.success("Welcome!");
        await navigate({ to: "/projects", replace: true });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
        await navigate({ to: "/projects", replace: true });
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
      <div
        className="pointer-events-none absolute -right-16 top-60 h-80 w-80 rounded-full bg-lavender/40 blur-3xl animate-blob"
        style={{ animationDelay: "-5s" }}
      />

      <div className="mx-auto w-full max-w-sm">
        <Link to="/" className="flex items-center gap-2">
          <BrandMark className="h-9 w-9" />
          <BrandWordmark size="text-xl" />
        </Link>

        <div className="glass-card mt-8 rounded-3xl p-6 sm:p-7">
          <h1 className="font-display text-3xl">{titleForMode(mode)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitleForMode(mode)}</p>

          {notice && (
            <div className="mt-5 rounded-2xl bg-mint/45 px-4 py-3 text-sm text-ink">{notice}</div>
          )}

          {mode === "check-email" ? (
            <div className="mt-6 rounded-3xl bg-white/70 p-5 text-center">
              <Mail className="mx-auto h-8 w-8 text-coral" />
              <p className="mt-3 text-sm text-muted-foreground">
                Open the link from Supabase to finish. Mailgun SMTP can power these emails once it
                is configured in the Supabase dashboard.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-3">
              {mode !== "reset" && (
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
              )}
              {mode !== "forgot" && mode !== "magic" && (
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  placeholder={mode === "reset" ? "New password" : "Password (min 6 chars)"}
                  value={mode === "reset" ? newPassword : password}
                  onChange={(e) =>
                    mode === "reset" ? setNewPassword(e.target.value) : setPassword(e.target.value)
                  }
                  disabled={busy}
                  className="h-12 w-full rounded-xl border border-ink/10 bg-white px-4 text-base outline-none focus:border-coral disabled:opacity-60"
                />
              )}

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
                {busy ? "Working…" : ctaForMode(mode)}
              </button>
            </form>
          )}

          <div className="mt-4 space-y-2 text-center text-xs text-muted-foreground">
            {mode !== "signin" && (
              <button type="button" onClick={() => switchMode("signin")} className="underline">
                Back to sign in
              </button>
            )}
            {mode === "signin" && (
              <>
                <button type="button" onClick={() => switchMode("signup")} className="underline">
                  Need an account? Sign up
                </button>
                <span className="px-2">·</span>
                <button type="button" onClick={() => switchMode("forgot")} className="underline">
                  Forgot password?
                </button>
                <div>
                  <button
                    type="button"
                    onClick={() => switchMode("magic")}
                    className="inline-flex items-center gap-1 underline"
                  >
                    <Sparkles className="h-3 w-3" /> Send a magic link
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );

  function switchMode(next: AuthMode) {
    setError(null);
    setNotice(null);
    setMode(next);
  }
}

type AuthMode = "signin" | "signup" | "forgot" | "reset" | "magic" | "check-email" | "verified";

function initialMode(): AuthMode {
  if (typeof window === "undefined") return "signin";
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const mode = params.get("mode");
  const type = params.get("type") ?? hash.get("type");
  if (mode === "reset" || type === "recovery") return "reset";
  if (mode === "verified" || type === "signup" || type === "magiclink") return "verified";
  return "signin";
}

function authRedirectUrl(mode: "reset" | "verified") {
  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("mode", mode);
  return url.toString();
}

function titleForMode(mode: AuthMode) {
  if (mode === "signup") return "Create account";
  if (mode === "forgot") return "Reset password";
  if (mode === "reset") return "Choose a new password";
  if (mode === "magic") return "Email me a sign-in link";
  if (mode === "check-email") return "Check your email";
  if (mode === "verified") return "Email confirmed";
  return "Welcome back";
}

function subtitleForMode(mode: AuthMode) {
  if (mode === "signup") return "Sign up, confirm your email, then your projects stay with you.";
  if (mode === "forgot") return "We will send a secure reset link to your inbox.";
  if (mode === "reset") return "Enter your new password to finish recovering your account.";
  if (mode === "magic") return "No password needed. Supabase will email you a one-time link.";
  if (mode === "check-email") return "The next step is waiting in your inbox.";
  if (mode === "verified") return "You are good to go.";
  return "Sign in to keep curating.";
}

function ctaForMode(mode: AuthMode) {
  if (mode === "signup") return "Sign up";
  if (mode === "forgot") return "Send reset link";
  if (mode === "reset") return "Update password";
  if (mode === "magic") return "Send magic link";
  return "Sign in";
}
