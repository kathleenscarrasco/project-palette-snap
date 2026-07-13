import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, Lock, Sparkles, Wand2 } from "lucide-react";

import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FotoFairy — Camera roll sorting for photo collections" },
      {
        name: "description",
        content:
          "FotoFairy finds the strongest photos, groups similar moments, and helps you build a polished collection without sorting everything manually.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();

  function startSorting() {
    void navigate({ to: isAuthed ? "/projects" : "/auth" });
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed -left-24 top-20 h-80 w-80 rounded-full bg-coral/25 blur-3xl" />
      <div className="pointer-events-none fixed -right-28 top-72 h-96 w-96 rounded-full bg-mint/30 blur-3xl" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Link to="/" className="flex items-center gap-2">
          <BrandMark className="h-10 w-10" />
          <BrandWordmark size="text-xl" />
        </Link>
        <nav className="hidden items-center gap-5 text-sm font-semibold text-muted-foreground sm:flex">
          <a href="#how-it-works" className="hover:text-foreground">
            How it works
          </a>
          <a href="#trust" className="hover:text-foreground">
            Trust
          </a>
          <Link to="/auth" className="hover:text-foreground">
            Sign in
          </Link>
        </nav>
        <button
          type="button"
          onClick={startSorting}
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-ink px-4 text-sm font-bold text-cream shadow-lg transition hover:bg-coral"
        >
          Start sorting <ArrowRight className="h-4 w-4" />
        </button>
      </header>

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-84px)] max-w-6xl items-center gap-10 px-5 pb-12 pt-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-mint/50 px-3 py-1 text-xs font-bold text-ink">
            <Sparkles className="h-3.5 w-3.5" />
            Hybrid local + secure AI photo curation
          </div>
          <h1 className="mt-5 max-w-3xl font-display text-5xl leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            Turn your camera roll into the perfect photo collection.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            FotoFairy finds the strongest photos, groups similar moments, and helps you build a
            polished collection without sorting everything manually.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={startSorting}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-ink px-6 text-base font-bold text-cream shadow-xl transition hover:bg-coral"
            >
              Start sorting <Wand2 className="h-4 w-4" />
            </button>
            <a
              href="#how-it-works"
              className="inline-flex h-14 items-center justify-center rounded-2xl border border-ink/10 bg-white/70 px-6 text-base font-bold text-ink"
            >
              See how it works
            </a>
          </div>
          {isAuthed && (
            <Link
              to="/projects"
              className="mt-4 inline-flex text-sm font-semibold text-muted-foreground underline"
            >
              Go to my collections
            </Link>
          )}
        </div>

        <ProductPreview />
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            "Scan large camera-roll batches",
            "Find duplicate and near-duplicate shots",
            "Group related events and moments",
            "Compare similar photos at full size",
            "Build a balanced final shortlist",
            "Save collections and come back later",
          ].map((item) => (
            <div key={item} className="rounded-3xl bg-white/75 p-5 shadow-sm">
              <Check className="h-5 w-5 text-coral" />
              <p className="mt-3 text-sm font-semibold text-ink">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 mx-auto max-w-6xl px-5 py-14">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-wider text-coral">How it works</p>
          <h2 className="mt-2 font-display text-4xl">From camera roll chaos to keeper set.</h2>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {[
            ["1", "Upload your camera roll", "Choose JPG, PNG, HEIC, or mixed photo batches."],
            ["2", "Let FotoFairy organize it", "Quick checks group moments and flag look-alikes."],
            [
              "3",
              "Compare similar photos",
              "Review groups, favorites, and removals before the cut.",
            ],
            [
              "4",
              "Save your final collection",
              "Keep the order, caption, cover, and draft for later.",
            ],
          ].map(([step, title, body]) => (
            <div key={step} className="rounded-3xl bg-cream/80 p-5">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-coral text-sm font-bold text-white">
                {step}
              </div>
              <h3 className="mt-4 text-base font-bold text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="trust" className="relative z-10 mx-auto max-w-6xl px-5 py-14">
        <div className="rounded-[2rem] bg-ink p-6 text-cream sm:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-mint">
                <Lock className="h-4 w-4" />
                Trust & privacy
              </div>
              <h2 className="mt-3 font-display text-4xl">
                Private saved collections, clear AI use.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-cream/75">
                FotoFairy combines fast on-device checks with secure AI analysis for photos that
                need a closer look. Saved projects use private cloud storage, and AI requests go
                through the server so keys are not exposed in your browser.
              </p>
            </div>
            <Link
              to="/trust"
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-cream px-5 text-sm font-bold text-ink"
            >
              Read more
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function ProductPreview() {
  const tiles = [
    ["Upload", "29 photos ready"],
    ["Scanning", "18 closer reviews"],
    ["Look-alikes", "Compare the best"],
    ["Shortlist", "Tap groups to review"],
    ["Final order", "Balanced for the scroll"],
  ];

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="rounded-[2rem] bg-white/80 p-4 shadow-2xl backdrop-blur">
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, index) => (
            <div
              key={index}
              className="aspect-square rounded-2xl bg-gradient-to-br from-coral/80 via-lavender/70 to-mint/70"
              style={{ opacity: 0.65 + (index % 3) * 0.1 }}
            />
          ))}
        </div>
        <div className="mt-4 space-y-2">
          {tiles.map(([title, body]) => (
            <div
              key={title}
              className="flex items-center justify-between rounded-2xl bg-cream px-4 py-3"
            >
              <span className="text-sm font-bold text-ink">{title}</span>
              <span className="text-xs font-semibold text-muted-foreground">{body}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
