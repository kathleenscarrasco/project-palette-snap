import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Heart, Shuffle, Upload, Wand2, Hand, Film, LogOut, FolderOpen } from "lucide-react";
import { useEffect } from "react";
import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "dumpify — Turn 200 photos into the perfect photo dump" },
      {
        name: "description",
        content:
          "AI-powered photo dump curator. Upload many photos, narrow them down, swipe what stays, and let AI order your Instagram carousel.",
      },
      { property: "og:title", content: "dumpify — Curate your photo dump" },
      {
        property: "og:description",
        content: "Turn 200 photos into the perfect 10-image Instagram carousel.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const { isAuthed, loading, bypassed, user, signOut } = useAuth();

  useEffect(() => {
    if (!loading && !isAuthed) navigate({ to: "/auth" });
  }, [loading, isAuthed, navigate]);

  if (loading || !isAuthed) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 pb-16 pt-8">
      <div className="absolute right-5 top-5 z-10 flex items-center gap-2">
        <span className="chip">{bypassed ? "bypass mode" : user?.email}</span>
        <button
          onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
          className="chip hover:bg-coral hover:text-white"
          aria-label="Sign out"
        >
          <LogOut className="h-3 w-3" /> Sign out
        </button>
      </div>
      {/* floating blobs */}
      <div className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-coral/30 blur-3xl animate-blob" />
      <div className="pointer-events-none absolute -right-16 top-60 h-80 w-80 rounded-full bg-lavender/40 blur-3xl animate-blob" style={{ animationDelay: "-5s" }} />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-mint/40 blur-3xl animate-blob" style={{ animationDelay: "-9s" }} />

      <div className="mx-auto max-w-md">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrandMark className="h-9 w-9" />
            <BrandWordmark size="text-xl" />
          </div>
          <span className="chip">beta · v0.1</span>
        </header>

        <section className="mt-10">
          <motion.span
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="chip bg-coral/15 text-coral"
          >
            <Sparkles className="h-3 w-3" /> AI photo dump curator
          </motion.span>

          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.05 }}
            className="font-display mt-4 text-5xl leading-[0.95] tracking-tight"
          >
            Turn <em className="italic text-coral">200 photos</em> into the perfect{" "}
            <span className="relative inline-block">
              photo dump
              <svg viewBox="0 0 200 12" className="absolute -bottom-1 left-0 h-2 w-full text-mint" fill="currentColor">
                <path d="M0 8 Q 50 0 100 6 T 200 4 L 200 12 L 0 12 Z" />
              </svg>
            </span>
            .
          </motion.h1>

          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="mt-5 text-base text-muted-foreground"
          >
            Upload your camera roll. We score every shot, kill the dupes, and help you swipe down to the ten that pop.
          </motion.p>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="mt-7"
          >
            <Link
              to="/app"
              className="group inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink px-6 text-base font-semibold text-cream shadow-xl transition hover:bg-coral"
            >
              Start sorting
              <ArrowRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
            </Link>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Free · runs in your browser · no signup
            </p>
          </motion.div>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-2xl">How it works</h2>
          <ol className="mt-4 space-y-3">
            <Step n={1} title="Upload" body="Drop in 50, 200, 500 photos." Icon={Upload} tint="bg-coral/15 text-coral" />
            <Step n={2} title="AI narrows them down" body="Bye blur, dupes, and the awkward ones." Icon={Wand2} tint="bg-lavender/60 text-ink" />
            <Step n={3} title="Swipe to keep or kill" body="Tinder-style. Be ruthless." Icon={Hand} tint="bg-mint/60 text-ink" />
            <Step n={4} title="AI orders your post" body="Strongest first, funny last, balanced flow." Icon={Film} tint="bg-coral/15 text-coral" />
          </ol>
        </section>

        <section className="mt-12 grid grid-cols-3 gap-3">
          <Stat icon={<Sparkles className="h-4 w-4" />} value="9" label="AI tags" />
          <Stat icon={<Heart className="h-4 w-4" />} value="20" label="max slides" />
          <Stat icon={<Shuffle className="h-4 w-4" />} value="∞" label="reorders" />
        </section>

        <footer className="mt-16 text-center text-xs text-muted-foreground">
          <div className="mb-2">
            <Link to="/todos" className="underline hover:text-ink">Todos</Link>
          </div>
          Made for the dump-deserving moments.
        </footer>
      </div>
    </main>
  );
}

function Step({
  n,
  title,
  body,
  Icon,
  tint,
}: {
  n: number;
  title: string;
  body: string;
  Icon: React.ComponentType<{ className?: string }>;
  tint: string;
}) {
  return (
    <li className="glass-card flex items-start gap-3 rounded-2xl p-4">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tint}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-coral">STEP {n}</span>
        </div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{body}</div>
      </div>
    </li>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="glass-card rounded-2xl p-3 text-center">
      <div className="mx-auto mb-1 grid h-7 w-7 place-items-center rounded-full bg-coral/15 text-coral">
        {icon}
      </div>
      <div className="font-display text-2xl leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
