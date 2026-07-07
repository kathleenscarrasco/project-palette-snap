import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Confirming email · dumpify" }] }),
  component: AuthCallbackPage,
});

type CallbackState =
  | { status: "loading"; message: string }
  | { status: "success"; message: string; destination: "/projects" | "/auth" }
  | { status: "error"; message: string };

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>({
    status: "loading",
    message: "Confirming your email…",
  });

  useEffect(() => {
    let cancelled = false;

    async function handleCallback() {
      try {
        const url = new URL(window.location.href);
        const search = new URLSearchParams(url.search);
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
        const params = {
          code: search.get("code"),
          mode: search.get("mode") ?? hash.get("mode"),
          type: search.get("type") ?? hash.get("type"),
          accessToken: search.get("access_token") ?? hash.get("access_token"),
          refreshToken: search.get("refresh_token") ?? hash.get("refresh_token"),
          error: search.get("error") ?? hash.get("error"),
          errorDescription:
            search.get("error_description") ??
            hash.get("error_description") ??
            search.get("error_code") ??
            hash.get("error_code"),
        };

        if (params.error) {
          throw new Error(params.errorDescription ?? params.error);
        }

        if (params.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(params.code);
          if (error) throw error;
        } else if (params.accessToken && params.refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: params.accessToken,
            refresh_token: params.refreshToken,
          });
          if (error) throw error;
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) {
            throw new Error("We could not find a valid confirmation session.");
          }
        }

        window.history.replaceState({}, document.title, "/auth/callback");

        const isPasswordReset = params.mode === "reset" || params.type === "recovery";
        const destination = isPasswordReset ? "/auth" : "/projects";
        if (!cancelled) {
          setState({
            status: "success",
            message: isPasswordReset
              ? "Email confirmed! Taking you to reset your password…"
              : "Email confirmed! Taking you to your projects…",
            destination,
          });
        }
        window.setTimeout(() => {
          if (cancelled) return;
          if (isPasswordReset) {
            void navigate({ to: "/auth", search: { mode: "reset" }, replace: true });
          } else {
            void navigate({ to: "/projects", replace: true });
          }
        }, 1100);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "This confirmation link is invalid or has expired.";
        console.error("[auth] callback failed:", err);
        if (!cancelled) setState({ status: "error", message });
      }
    }

    void handleCallback();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-10 text-center">
      <div className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-coral/30 blur-3xl animate-blob" />
      <div
        className="pointer-events-none absolute -right-16 top-60 h-80 w-80 rounded-full bg-lavender/40 blur-3xl animate-blob"
        style={{ animationDelay: "-5s" }}
      />

      <section className="glass-card w-full max-w-sm rounded-3xl p-7">
        <Link to="/" className="mx-auto flex w-fit items-center gap-2">
          <BrandMark className="h-10 w-10" />
          <BrandWordmark size="text-xl" />
        </Link>

        <div className="mt-7 flex justify-center">
          {state.status === "loading" && (
            <span className="grid h-14 w-14 place-items-center rounded-full bg-mint/60 text-ink">
              <Loader2 className="h-7 w-7 animate-spin" />
            </span>
          )}
          {state.status === "success" && (
            <span className="grid h-14 w-14 place-items-center rounded-full bg-mint/70 text-ink">
              <CheckCircle2 className="h-7 w-7" />
            </span>
          )}
          {state.status === "error" && (
            <span className="grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
              <XCircle className="h-7 w-7" />
            </span>
          )}
        </div>

        <h1 className="mt-5 font-display text-3xl">
          {state.status === "error" ? "Confirmation failed" : "Email confirmed!"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>

        {state.status === "error" && (
          <div className="mt-6 flex justify-center">
            <Link
              to="/auth"
              className="inline-flex h-11 items-center rounded-xl bg-ink px-4 font-semibold text-cream transition hover:bg-coral"
            >
              Back to login
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
