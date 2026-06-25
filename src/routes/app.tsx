import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Eye,
  Heart,
  Laugh,
  Palette,
  Palmtree,
  RotateCcw,
  Save,
  Shuffle,
  Sparkles,
  Trash2,
  Undo2,
  Users,
  UtensilsCrossed,
  Wand2,
  X,
} from "lucide-react";

import JSZip from "jszip";
import { toast } from "sonner";
import { Copy, RefreshCw, MessageCircle } from "lucide-react";
import { generateCaptions, type CaptionIdea } from "@/lib/dumpdeck/captions";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { DumpDeckProvider, useDumpDeck } from "@/lib/dumpdeck/store";
import {
  aiOrder,
  analyzeImage,
  buildAllSimilarGroups,
  classifyPhoto,
  groupBestBadges,
  groupNearDuplicates,
  scorePhoto,
  shortlist,
} from "@/lib/dumpdeck/ai";
import { detectPeopleAndFaces, warmupDetection } from "@/lib/dumpdeck/detection";
import type { Photo, PostFormat, RemovedPhoto, Settings, VibeFocus } from "@/lib/dumpdeck/types";
import { UploadGrid, type UploadItem } from "@/components/dumpdeck/upload-grid";
import { PhotoCard } from "@/components/dumpdeck/photo-card";
import { SortableGrid } from "@/components/dumpdeck/sortable-grid";
import { ScoreBadge } from "@/components/dumpdeck/score-badge";
import { TagBadge } from "@/components/dumpdeck/tag-badge";
import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";


const MAX_KEEP = 20;

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "dumpify — Build your dump" },
      { name: "description", content: "Upload, analyze, curate, order, and export your photo dump." },
    ],
  }),
  component: () => (
    <DumpDeckProvider>
      <Shell />
      <Toaster position="top-center" richColors />
    </DumpDeckProvider>
  ),
});

const STAGES = ["setup", "upload", "analyze", "similar", "results", "curate", "final", "export"] as const;

const FORMAT_LABEL: Record<PostFormat, string> = {
  square: "Instagram square (1:1)",
  portrait: "Portrait carousel (4:5)",
  landscape: "Landscape (1.91:1)",
  story: "Story (9:16)",
};

const FORMAT_ASPECT: Record<PostFormat, string> = {
  square: "1 / 1",
  portrait: "4 / 5",
  landscape: "1.91 / 1",
  story: "9 / 16",
};

function Shell() {
  const { state } = useDumpDeck();
  return (
    <main className="relative mx-auto min-h-screen max-w-md px-4 pb-28 pt-6">
      <TopBar />
      <ProgressDots stage={state.stage} />

      <AnimatePresence mode="wait">
        <motion.div
          key={state.stage}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
          className="mt-6"
        >
          {state.stage === "setup" && <SetupStage />}
          {state.stage === "upload" && <UploadStage />}
          {state.stage === "analyze" && <AnalyzeStage />}
          {state.stage === "similar" && <SimilarStage />}
          {state.stage === "results" && <ResultsStage />}
          {state.stage === "curate" && <CurateStage />}
          {state.stage === "final" && <FinalStage />}
          {state.stage === "export" && <ExportStage />}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

function TopBar() {
  const { dispatch } = useDumpDeck();
  return (
    <header className="flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2">
        <BrandMark className="h-9 w-9" />
        <BrandWordmark size="text-lg" />
      </Link>
      <button
        onClick={() => {
          if (confirm("Start over? Your current progress will be cleared.")) dispatch({ type: "reset" });
        }}
        className="chip"
        type="button"
      >
        <RotateCcw className="h-3 w-3" /> Reset
      </button>
    </header>
  );
}

function ProgressDots({ stage }: { stage: (typeof STAGES)[number] }) {
  const i = STAGES.indexOf(stage);
  return (
    <div className="mt-5 flex items-center gap-1.5">
      {STAGES.map((s, idx) => (
        <div
          key={s}
          className={`h-1.5 flex-1 rounded-full transition-all ${idx <= i ? "bg-coral" : "bg-ink/10"}`}
        />
      ))}
    </div>
  );
}

/* ───────────── Setup ───────────── */
function SetupStage() {
  const { state, dispatch } = useDumpDeck();
  const [formats, setFormats] = useState<PostFormat[]>(state.settings.formats);
  const [vibes, setVibes] = useState<VibeFocus[]>(state.settings.vibes);

  function toggleFormat(f: PostFormat) {
    setFormats((cur) => {
      if (cur.includes(f)) {
        const next = cur.filter((x) => x !== f);
        return next.length ? next : cur;
      }
      if (cur.length >= 3) {
        toast.error("Pick up to 3 formats");
        return cur;
      }
      return [...cur, f];
    });
  }

  function toggleVibe(v: VibeFocus) {
    setVibes((cur) => {
      if (v === "random") return ["random"];
      const without = cur.filter((x) => x !== "random" && x !== v);
      if (cur.includes(v)) {
        return without.length === 0 ? (["random"] as VibeFocus[]) : without;
      }
      const next = [...without, v];
      if (next.length > 3) {
        toast.error("Pick up to 3 vibes");
        return cur;
      }
      return next;
    });
  }

  function next() {
    const settings: Settings = {
      formats: formats.length ? formats : (["portrait"] as PostFormat[]),
      vibes: vibes.length ? vibes : (["random"] as VibeFocus[]),
    };
    dispatch({ type: "setSettings", settings });
    dispatch({ type: "setStage", stage: "upload" });
  }

  const formatOpts: { id: PostFormat; label: string; ratio: string; box: string; grad: string }[] = [
    { id: "square",    label: "Instagram square",   ratio: "1 : 1",     box: "h-14 w-14",     grad: "bg-gradient-to-br from-coral to-butter" },
    { id: "portrait",  label: "Portrait carousel",  ratio: "4 : 5",     box: "h-16 w-[3.2rem]", grad: "bg-gradient-to-br from-lavender to-mint" },
    { id: "landscape", label: "Landscape",          ratio: "1.91 : 1",  box: "h-10 w-[4.2rem]", grad: "bg-gradient-to-br from-mint to-butter" },
    { id: "story",     label: "Story",              ratio: "9 : 16",    box: "h-16 w-9",       grad: "bg-gradient-to-br from-coral to-lavender" },
  ];

  const vibeOpts: {
    id: VibeFocus;
    label: string;
    Icon: typeof Heart;
    hint: string;
    tile: string;
  }[] = [
    { id: "cute",      label: "Cute",        Icon: Heart,            hint: "Soft, sweet moments",   tile: "from-coral/80 to-butter/80" },
    { id: "aesthetic", label: "Aesthetic",   Icon: Palette,          hint: "Color, light, mood",    tile: "from-lavender to-mint" },
    { id: "funny",     label: "Funny",       Icon: Laugh,            hint: "Chaotic, candid",       tile: "from-butter to-coral/70" },
    { id: "vacation",  label: "Vacation",    Icon: Palmtree,         hint: "Travel + scenery",      tile: "from-mint to-lavender" },
    { id: "food",      label: "Food",        Icon: UtensilsCrossed,  hint: "Plates + details",      tile: "from-coral/70 to-butter" },
    { id: "friends",   label: "Friends",     Icon: Users,            hint: "People-first",          tile: "from-mint to-butter" },
    { id: "random",    label: "Random dump", Icon: Shuffle,          hint: "A little of everything", tile: "from-lavender to-coral/70" },
  ];


  const formatsFull = formats.length >= 3;
  const vibesFull = vibes.length >= 3;

  return (
    <section>
      <Heading
        eyebrow="Step 0"
        title="What's the vibe?"
        body="Pick 1–3 of each. These change scoring, similar-photo grouping, and the final order."
      />

      {(formats.length > 0 || vibes.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {formats.map((f) => (
            <button
              key={`fchip-${f}`}
              type="button"
              onClick={() => toggleFormat(f)}
              className="chip bg-lavender/60 text-ink"
            >
              {FORMAT_LABEL[f]} <X className="h-3 w-3" />
            </button>
          ))}
          {vibes.map((v) => (
            <button
              key={`vchip-${v}`}
              type="button"
              onClick={() => toggleVibe(v)}
              className="chip bg-mint/60 text-ink"
            >
              #{v} <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Post format</div>
          <div className="text-[11px] text-muted-foreground">{formats.length}/3 picked</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {formatOpts.map((f) => {
            const active = formats.includes(f.id);
            const disabled = !active && formatsFull;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggleFormat(f.id)}
                disabled={disabled}
                className={`glass-card relative flex items-center gap-3 rounded-2xl p-3 text-left transition ${
                  active ? "ring-2 ring-coral" : ""
                } ${disabled ? "opacity-40" : ""}`}
              >
                <div className={`shrink-0 rounded-md ${f.grad} ${f.box}`} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-tight">{f.label}</div>
                  <div className="text-[10px] text-muted-foreground">{f.ratio}</div>
                </div>
                {active && <Check className="ml-auto h-4 w-4 text-coral" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Post vibe</div>
          <div className="text-[11px] text-muted-foreground">{vibes.length}/3 picked</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {vibeOpts.map((v) => {
            const active = vibes.includes(v.id);
            const disabled = !active && vibesFull && v.id !== "random";
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => toggleVibe(v.id)}
                disabled={disabled}
                className={`glass-card flex items-start gap-2 rounded-2xl p-3 text-left transition ${
                  active ? "ring-2 ring-coral" : ""
                } ${disabled ? "opacity-40" : ""}`}
              >
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${v.tile} text-ink shadow-sm ring-1 ring-white/40`}
                  aria-hidden
                >
                  <v.Icon className="h-5 w-5" strokeWidth={2.2} />
                </span>

                <div className="min-w-0">
                  <div className="text-sm font-semibold">{v.label}</div>
                  <div className="text-[11px] text-muted-foreground">{v.hint}</div>
                </div>
                {active && <Check className="ml-auto h-4 w-4 text-coral" />}
              </button>
            );
          })}
        </div>
      </div>

      <StickyAction>
        <Button
          onClick={next}
          className="h-14 w-full rounded-2xl bg-ink text-base font-semibold text-cream hover:bg-coral"
        >
          Next: upload photos →
        </Button>
      </StickyAction>
    </section>
  );
}

/* ───────────── Upload ───────────── */
function UploadStage() {
  const { state, dispatch } = useDumpDeck();
  const [items, setItems] = useState<UploadItem[]>([]);

  function handleAnalyze() {
    sessionStorage.setItem(
      "dumpdeck:pending",
      JSON.stringify(items.map((it) => ({ id: it.id, url: it.url, previewUrl: it.previewUrl, name: it.name, width: it.width, height: it.height }))),
    );
    dispatch({ type: "clearRemoved" });
    dispatch({ type: "setStage", stage: "analyze" });
  }

  return (
    <section>
      <Heading
        eyebrow="Step 1"
        title="Drop in your photos"
        body="The more you upload, the harder the AI works. Aim for 30+."
      />
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {state.settings.formats.map((f) => (
          <span key={f} className="chip bg-lavender/40">{FORMAT_LABEL[f]}</span>
        ))}
        {state.settings.vibes.map((v) => (
          <span key={v} className="chip bg-mint/40">#{v}</span>
        ))}
      </div>
      <div className="mt-5">
        <UploadGrid
          items={items}
          onAdd={(added) => setItems((cur) => [...cur, ...added])}
          onRemove={(id) => setItems((cur) => cur.filter((x) => x.id !== id))}
          onAnalyze={handleAnalyze}
        />
      </div>
      <div className="mt-4">
        <button
          onClick={() => dispatch({ type: "setStage", stage: "setup" })}
          className="chip"
          type="button"
        >
          ← Back to vibe
        </button>
      </div>
    </section>
  );
}

/* ───────────── Analyze ───────────── */
const ANALYZE_LINES = [
  "Reading every pixel…",
  "Loading TensorFlow people detector…",
  "Counting people + faces (COCO-SSD + MediaPipe)…",
  "Hashing for near-duplicates…",
  "Cosine-matching visually similar photos…",
  "Classifying selfies, food, landscapes…",
  "Scoring against your vibe & format…",
];


function AnalyzeStage() {
  const { state, dispatch } = useDumpDeck();
  const [progress, setProgress] = useState(0);
  const [line, setLine] = useState(0);
  const [sample, setSample] = useState<{ url: string; previewUrl?: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = sessionStorage.getItem("dumpdeck:pending");
      if (!raw) {
        dispatch({ type: "setStage", stage: "upload" });
        return;
      }
      const items: UploadItem[] = JSON.parse(raw);
      setSample(items.slice(0, 9).map((i) => ({ url: i.url, previewUrl: i.previewUrl })));

      await warmupDetection();

      const out: Photo[] = [];
      for (let i = 0; i < items.length; i++) {
        if (cancelled) return;
        const it = items[i];
        const src = it.previewUrl ?? it.url;
        const [analysis, detection] = await Promise.all([
          analyzeImage(src),
          detectPeopleAndFaces(src),
        ]);
        analysis.detectedPeopleCount = detection.detectedPeopleCount;
        analysis.detectedFaceCount = detection.detectedFaceCount;
        analysis.detectionConfidence = detection.confidence;
        analysis.peopleUnsure = detection.unsure;
        analysis.peopleBoxes = detection.peopleBoxes;
        analysis.faceBoxes = detection.faceBoxes;

        const cls = classifyPhoto(it.width, it.height, analysis);
        const s = scorePhoto({ width: it.width, height: it.height, analysis }, cls, state.settings);
        out.push({
          ...it,
          analysis,
          group: 0,
          ...cls,
          ...s,
        });
        const p = (i + 1) / items.length;
        setProgress(p);
        setLine(Math.min(ANALYZE_LINES.length - 1, Math.floor(p * ANALYZE_LINES.length)));
        if (i % 4 === 3) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      if (cancelled) return;

      const groups = buildAllSimilarGroups(out);
      const hasGroups = groups.some((g) => g.photos.length > 1);

      dispatch({ type: "setPhotos", photos: out });

      setTimeout(() => {
        if (hasGroups) {
          dispatch({ type: "setStage", stage: "similar" });
        } else {
          const sl = shortlist(out);
          const cutEntries: RemovedPhoto[] = out
            .filter((p) => !sl.some((q) => q.id === p.id))
            .map((p) => ({
              photo: p,
              reason: "Cut from shortlist — low sharpness/contrast.",
              source: "ai",
            }));
          if (cutEntries.length) dispatch({ type: "addRemoved", entries: cutEntries });
          dispatch({ type: "setShortlist", photos: sl });
          dispatch({ type: "setStage", stage: "results" });
        }
      }, 300);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="text-center">
      <Heading eyebrow="Step 2" title="AI is reading your roll" body="Brightness, sharpness, palette, people, near-duplicates." />

      <div className="relative mx-auto mt-8 grid h-64 w-64 grid-cols-3 gap-1.5">
        {sample.map((p, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="overflow-hidden rounded-xl bg-muted"
          >
            <img src={p.previewUrl ?? p.url} alt="" decoding="async" className="h-full w-full object-cover" />
          </motion.div>
        ))}
        <motion.div
          aria-hidden
          animate={{ y: [0, 240, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none absolute inset-x-0 h-8 rounded-full bg-gradient-to-b from-transparent via-coral/60 to-transparent blur-sm"
        />
      </div>

      <div className="mx-auto mt-8 max-w-xs">
        <div className="h-2 overflow-hidden rounded-full bg-ink/10">
          <motion.div className="h-full rounded-full bg-coral" animate={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={line}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mt-3 font-display text-xl"
          >
            {ANALYZE_LINES[line]}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

/* ───────────── Similar ───────────── */
function SimilarStage() {
  const { state, dispatch } = useDumpDeck();

  const allGroups = useMemo(() => buildAllSimilarGroups(state.photos), [state.photos]);
  const similarGroups = useMemo(
    () => allGroups.filter((g) => g.photos.length > 1),
    [allGroups],
  );
  const singletonIds = useMemo(() => {
    const ids = new Set<string>();
    allGroups.forEach((g) => {
      if (g.photos.length === 1) ids.add(g.photos[0].id);
    });
    return ids;
  }, [allGroups]);

  const badgesByGroup = useMemo(() => {
    const m: Record<number, Record<string, string[]>> = {};
    similarGroups.forEach((g) => (m[g.id] = groupBestBadges(g.photos)));
    return m;
  }, [similarGroups]);

  const MAX_PICK = 4;

  const [picked, setPicked] = useState<Record<number, Set<string>>>(() => {
    const out: Record<number, Set<string>> = {};
    similarGroups.forEach((g) => {
      out[g.id] = new Set([g.photos[0].id]);
    });
    return out;
  });

  function togglePick(groupId: number, photoId: string) {
    setPicked((cur) => {
      const set = new Set(cur[groupId] ?? []);
      if (set.has(photoId)) {
        set.delete(photoId);
      } else {
        if (set.size >= MAX_PICK) {
          toast.error(`Pick up to ${MAX_PICK} per group`);
          return cur;
        }
        set.add(photoId);
      }
      return { ...cur, [groupId]: set };
    });
  }

  function keepAiPick(groupId: number) {
    const g = similarGroups.find((x) => x.id === groupId);
    if (!g) return;
    setPicked((cur) => ({ ...cur, [groupId]: new Set([g.photos[0].id]) }));
    toast.success("Keeping AI's pick for this group");
  }

  function skipGroup(groupId: number) {
    const g = similarGroups.find((x) => x.id === groupId);
    if (!g) return;
    setPicked((cur) => ({ ...cur, [groupId]: new Set(g.photos.map((p) => p.id)) }));
    toast("Keeping all photos in this group");
  }

  function keepAllAi() {
    const next: Record<number, Set<string>> = {};
    similarGroups.forEach((g) => (next[g.id] = new Set([g.photos[0].id])));
    setPicked(next);
    toast.success("Applied AI picks to every group");
  }

  function next() {
    const keepIds = new Set<string>(singletonIds);
    Object.values(picked).forEach((set) => set.forEach((id) => keepIds.add(id)));

    const drops: RemovedPhoto[] = [];
    for (const g of similarGroups) {
      const selected = picked[g.id] ?? new Set<string>();
      const keptInGroup = g.photos.filter((p) => selected.has(p.id));
      const keptTop = keptInGroup[0] ?? g.photos[0];
      for (const p of g.photos) {
        if (!selected.has(p.id)) {
          drops.push({
            photo: p,
            reason: selected.size === 0
              ? "User did not select from similar group."
              : `Removed from similar group — kept "${keptTop.name}" instead.`,
            source: "user",
            similarToId: keptTop.id,
          });
        }
      }
    }
    if (drops.length) dispatch({ type: "addRemoved", entries: drops });

    const survivors = state.photos.filter((p) => keepIds.has(p.id));
    const sl = shortlist(survivors);
    const cuts: RemovedPhoto[] = survivors
      .filter((p) => !sl.some((q) => q.id === p.id))
      .map((p) => ({ photo: p, reason: "Cut from shortlist — low sharpness/contrast.", source: "ai" }));
    if (cuts.length) dispatch({ type: "addRemoved", entries: cuts });

    dispatch({ type: "setShortlist", photos: sl });
    dispatch({ type: "setStage", stage: "results" });
  }

  const totalInGroups = similarGroups.reduce((a, g) => a + g.photos.length, 0);
  const totalPicked = Object.values(picked).reduce((a, s) => a + s.size, 0);
  const totalKept = totalPicked + singletonIds.size;

  return (
    <section>
      <Heading
        eyebrow="Step 3"
        title="Look-alike shots"
        body={`We found ${similarGroups.length} group${similarGroups.length === 1 ? "" : "s"} of similar photos. Pick up to ${MAX_PICK} from each — the rest get cut.`}
      />

      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        <span className="chip bg-mint/40">{totalKept} keeping</span>
        <span className="text-muted-foreground">{totalInGroups - totalPicked} cutting</span>
        <button type="button" onClick={keepAllAi} className="chip bg-coral/15 text-coral">
          Keep all AI picks
        </button>
      </div>

      <div className="mt-5 space-y-5">
        {similarGroups.map((g) => {
          const sel = picked[g.id] ?? new Set<string>();
          const badges = badgesByGroup[g.id] ?? {};
          return (
            <div key={g.id} className="glass-card rounded-3xl p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Group {g.id + 1} · {g.kind === "near-dup" ? "Near-duplicates" : "Look-alikes"}
                </span>
                <span className="text-[11px] font-semibold text-ink">
                  {sel.size} of {g.photos.length} selected
                </span>
              </div>
              <p className="mb-2 px-1 text-[11px] text-muted-foreground">
                These photos look similar. Pick up to {MAX_PICK} to keep.
              </p>

              <div className="grid grid-cols-3 gap-1.5">
                {g.photos.map((p, idx) => {
                  const isPicked = sel.has(p.id);
                  const isAiPick = idx === 0;
                  const photoBadges = badges[p.id] ?? [];
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePick(g.id, p.id)}
                      className={`relative overflow-hidden rounded-xl bg-muted transition ${
                        isPicked ? "ring-4 ring-coral" : "opacity-75"
                      }`}
                      style={{ aspectRatio: "1 / 1" }}
                    >
                      <img
                        src={p.previewUrl ?? p.url}
                        alt=""
                        decoding="async"
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute left-1 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-ink">
                        {Math.round(p.overall * 100)}
                      </div>
                      {isAiPick && (
                        <div className="absolute right-1 top-1 rounded-md bg-coral px-1 py-0.5 text-[9px] font-bold text-white shadow">
                          AI PICK
                        </div>
                      )}
                      {photoBadges.length > 0 && (
                        <div className="absolute inset-x-1 bottom-1 flex flex-wrap gap-0.5">
                          {photoBadges.slice(0, 2).map((b) => (
                            <span
                              key={b}
                              className="rounded-sm bg-black/70 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white"
                            >
                              {b}
                            </span>
                          ))}
                        </div>
                      )}
                      {isPicked && (
                        <div className="absolute right-1 bottom-1 grid h-6 w-6 place-items-center rounded-full bg-coral text-white shadow">
                          <Check className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => keepAiPick(g.id)}
                  className="chip bg-coral/15 text-coral"
                >
                  Keep AI's pick
                </button>
                <button
                  type="button"
                  onClick={() => skipGroup(g.id)}
                  className="chip"
                >
                  Skip group (keep all)
                </button>
                <span className="chip bg-ink/5 text-ink/70">
                  {sel.size > 0 ? `${sel.size} selected` : "None selected"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <StickyAction>
        <Button
          onClick={next}
          className="h-14 w-full rounded-2xl bg-ink text-base font-semibold text-cream hover:bg-coral"
        >
          Keep selected — continue with {totalKept} →
        </Button>
      </StickyAction>
    </section>
  );
}

/* ───────────── Results ───────────── */
function ResultsStage() {
  const { state, dispatch } = useDumpDeck();
  const [showRemoved, setShowRemoved] = useState(false);
  const removed = state.photos.length - state.shortlist.length;

  function restore(id: string) {
    dispatch({ type: "restorePhoto", id });
    toast.success("Restored to your shortlist.");
  }

  return (
    <section>
      <Heading
        eyebrow="Step 4"
        title="Your shortlist"
        body={`We cut ${removed} low-quality or duplicate shot${removed === 1 ? "" : "s"}. Tap a card to see why it stayed.`}
      />

      <div className="mt-4 grid grid-cols-3 gap-1.5 sm:gap-2">
        <ScoreBadge label="Cut" value={removed / Math.max(1, state.photos.length)} />
        <ScoreBadge label="Top score" value={state.shortlist[0]?.overall ?? 0} />
        <ScoreBadge label="Kept" value={state.shortlist.length / Math.max(1, state.photos.length)} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {state.shortlist.length} kept · {state.removed.length} removed
        </span>
        <button
          type="button"
          onClick={() => setShowRemoved(true)}
          className="chip"
        >
          <Eye className="h-3 w-3" /> View removed ({state.removed.length})
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {state.shortlist.map((p) => (
          <PhotoCard key={p.id} photo={p} />
        ))}
      </div>

      <StickyAction>
        <Button
          onClick={() => dispatch({ type: "setStage", stage: "curate" })}
          className="h-14 w-full rounded-2xl bg-ink text-base font-semibold text-cream hover:bg-coral"
        >
          Start cutting →
        </Button>
      </StickyAction>

      <RemovedModal
        open={showRemoved}
        onClose={() => setShowRemoved(false)}
        removed={state.removed}
        onRestore={restore}
      />
    </section>
  );
}

/* ───────────── Curate ───────────── */
function CurateStage() {
  const { state, dispatch } = useDumpDeck();
  const [remaining, setRemaining] = useState<Photo[]>(state.shortlist);
  const [focusIdx, setFocusIdx] = useState(0);
  const [showRemoved, setShowRemoved] = useState(false);
  const [dragX, setDragX] = useState(0);

  useEffect(() => {
    if (focusIdx >= remaining.length) setFocusIdx(Math.max(0, remaining.length - 1));
  }, [remaining.length, focusIdx]);

  const focus = remaining[focusIdx];
  const canContinue = remaining.length <= MAX_KEEP && remaining.length > 0;
  const overBy = Math.max(0, remaining.length - MAX_KEEP);

  const advance = useCallback(() => {
    setFocusIdx((i) => Math.min(remaining.length - 1, i + 1));
  }, [remaining.length]);

  const goBack = useCallback(() => {
    setFocusIdx((i) => Math.max(0, i - 1));
  }, []);

  const remove = useCallback((id: string) => {
    setRemaining((cur) => {
      const idx = cur.findIndex((p) => p.id === id);
      if (idx === -1) return cur;
      const photo = cur[idx];
      dispatch({
        type: "addRemoved",
        entries: [{ photo, reason: "Removed by you during curate.", source: "user" }],
      });
      const next = cur.filter((p) => p.id !== id);
      setFocusIdx((fi) => Math.min(Math.max(0, next.length - 1), idx === fi ? idx : fi > idx ? fi - 1 : fi));
      return next;
    });
  }, [dispatch]);

  const restore = useCallback((id: string) => {
    const entry = state.removed.find((r) => r.photo.id === id);
    if (!entry) return;
    setRemaining((cur) => (cur.some((p) => p.id === id) ? cur : [...cur, entry.photo]));
    dispatch({ type: "restorePhoto", id });
    toast.success("Restored to your shortlist.");
  }, [state.removed, dispatch]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (showRemoved) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (focus) remove(focus.id);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goBack();
      } else if (e.key.toLowerCase() === "u") {
        e.preventDefault();
        const last = state.removed[state.removed.length - 1];
        if (last && last.source === "user") restore(last.photo.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, advance, goBack, remove, restore, state.removed, showRemoved]);

  function onDragEnd(_: unknown, info: PanInfo) {
    setDragX(0);
    const threshold = 110;
    if (info.offset.x < -threshold) {
      if (focus) remove(focus.id);
    } else if (info.offset.x > threshold) {
      advance();
    }
  }

  function continueToFinal() {
    const nearDupGroups = groupNearDuplicates(remaining).filter((g) => g.photos.length > 1);
    const autoCut = nearDupGroups.flatMap((g) => g.photos.slice(1).map((photo) => ({
      photo,
      reason: `Removed before final because it was almost identical to "${g.photos[0].name}".`,
      source: "ai" as const,
      similarToId: g.photos[0].id,
    })));
    const finalPhotos = nearDupGroups.length
      ? remaining.filter((p) => !autoCut.some((r) => r.photo.id === p.id))
      : remaining;
    if (autoCut.length) {
      dispatch({ type: "addRemoved", entries: autoCut });
      toast.success(`Removed ${autoCut.length} near-duplicate${autoCut.length === 1 ? "" : "s"} before final.`);
    }
    dispatch({ type: "setKept", photos: finalPhotos });
    dispatch({ type: "setFinalOrder", photos: finalPhotos });
    dispatch({ type: "setStage", stage: "final" });
  }

  return (
    <section>
      <Heading
        eyebrow="Step 5"
        title="Cut it down"
        body={`Swipe ← to remove, → to keep. Aim for ${MAX_KEEP} or fewer.`}
      />

      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        <span className="chip bg-mint/40">{remaining.length} left</span>
        {overBy > 0 ? (
          <span className="chip bg-coral/20 text-coral">Cut {overBy} more</span>
        ) : (
          <span className="chip inline-flex items-center gap-1 bg-mint/60 text-ink"><Check className="h-3 w-3" /> Under limit</span>
        )}
        <button
          type="button"
          onClick={() => setShowRemoved(true)}
          className="chip"
        >
          <Eye className="h-3 w-3" /> Removed ({state.removed.length})
        </button>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div
          className={`h-full rounded-full transition-all ${overBy > 0 ? "bg-coral" : "bg-mint"}`}
          style={{ width: `${Math.min(100, ((focusIdx + 1) / Math.max(1, remaining.length)) * 100)}%` }}
        />
      </div>

      {focus ? (
        <div className="mt-5 relative">
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-between px-4"
          >
            <div
              className="rounded-2xl bg-coral px-3 py-2 text-xs font-bold text-white shadow-lg transition"
              style={{ opacity: Math.max(0, -dragX / 120) }}
            >
              REMOVE
            </div>
            <div
              className="rounded-2xl bg-mint px-3 py-2 text-xs font-bold text-ink shadow-lg transition"
              style={{ opacity: Math.max(0, dragX / 120) }}
            >
              KEEP →
            </div>
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={focus.id}
              drag="x"
              dragElastic={0.25}
              dragConstraints={{ left: 0, right: 0 }}
              onDrag={(_, info) => setDragX(info.offset.x)}
              onDragEnd={onDragEnd}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1, x: 0, rotate: 0 }}
              exit={{ opacity: 0, x: dragX < 0 ? -400 : 400, rotate: dragX < 0 ? -8 : 8 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              style={{ rotate: dragX / 30 }}
              className="relative overflow-hidden rounded-3xl bg-muted shadow-xl touch-pan-y"
            >
              <div style={{ aspectRatio: "4 / 5" }}>
                <img src={focus.previewUrl ?? focus.url} alt="" decoding="async" className="h-full w-full object-cover pointer-events-none" draggable={false} />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute left-3 top-3 flex flex-wrap gap-1">
                {focus.tags.slice(0, 3).map((t) => (
                  <TagBadge key={t} tag={t} />
                ))}
              </div>
              <div className="absolute right-3 top-3 rounded-full bg-white/95 px-2 py-1 text-[11px] font-bold text-ink">
                {Math.round(focus.overall * 100)}
              </div>
              <div className="absolute inset-x-3 bottom-3 text-[11px] font-semibold uppercase tracking-wider text-white/90">
                {focus.photoType}
                {focus.photoTypeConfidence < 0.55 && " (unsure)"} ·{" "}
                {focus.peopleCount === 4 ? "4+" : focus.peopleCount} people · {focus.orientation}
              </div>
            </motion.div>
          </AnimatePresence>

          {focus.reasons[0] && (
            <p className="mt-2 px-1 text-xs text-muted-foreground">{focus.reasons[0]}</p>
          )}

          <div className="mt-3 grid grid-cols-4 gap-2">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={focusIdx === 0}
              className="h-12 rounded-2xl border-ink/15 bg-white/70 font-semibold"
              aria-label="Previous"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => remove(focus.id)}
              className="h-12 rounded-2xl bg-coral font-semibold text-white shadow-lg hover:bg-coral/90"
            >
              <Trash2 className="mr-1 h-4 w-4" /> Remove
            </Button>
            <Button
              onClick={advance}
              disabled={focusIdx >= remaining.length - 1}
              className="col-span-2 h-12 rounded-2xl bg-ink font-semibold text-cream"
            >
              Keep <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>

          <div className="mt-2 text-center text-[11px] text-muted-foreground">
            Photo {focusIdx + 1} of {remaining.length} · ← remove · → keep · U undo
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-3xl bg-ink/5 p-8 text-center text-sm text-muted-foreground">
          No photos left. Restore some from "Removed".
        </div>
      )}

      {remaining.length > 0 && <MiniStrip remaining={remaining} focusIdx={focusIdx} onJump={setFocusIdx} />}

      {canContinue ? (
        <StickyAction>
          <Button
            onClick={continueToFinal}
            className="h-14 w-full rounded-2xl bg-ink text-base font-semibold text-cream hover:bg-coral"
          >
            Next: Order my dump ({remaining.length}) →
          </Button>
        </StickyAction>
      ) : (
        <StickyAction>
          <div className="rounded-2xl bg-ink/5 px-4 py-3 text-center text-sm font-semibold text-ink">
            {remaining.length} photos — cut {overBy} more to continue.
          </div>
        </StickyAction>
      )}

      <RemovedModal
        open={showRemoved}
        onClose={() => setShowRemoved(false)}
        removed={state.removed}
        onRestore={restore}
      />
    </section>
  );
}

/* ───────────── Removed Modal ───────────── */
function RemovedModal({
  open,
  onClose,
  removed,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  removed: RemovedPhoto[];
  onRestore: (id: string) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-3xl bg-cream sm:rounded-3xl"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-ink/10 bg-cream/95 px-4 py-3 backdrop-blur">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Removed photos
                </div>
                <div className="font-display text-lg">
                  {removed.length} photo{removed.length === 1 ? "" : "s"} cut
                </div>
              </div>
              <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-ink/10">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-4">
              {removed.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nothing removed yet.
                </p>
              ) : (
                <RemovedCategories removed={removed} onRestore={onRestore} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function categorize(r: RemovedPhoto): "similar" | "ai" | "user" {
  if (r.similarToId || /similar|duplicate|almost identical/i.test(r.reason)) return "similar";
  if (r.source === "ai") return "ai";
  return "user";
}

function friendlyReason(r: RemovedPhoto): string {
  const cat = categorize(r);
  if (cat === "similar") return r.reason || "Too similar to another photo.";
  if (cat === "ai") {
    if (/shortlist/i.test(r.reason)) return "Lower quality / sharpness score.";
    return r.reason || "AI cut — lower overall score.";
  }
  return r.reason || "You removed this one.";
}

function RemovedCategories({
  removed,
  onRestore,
}: {
  removed: RemovedPhoto[];
  onRestore: (id: string) => void;
}) {
  const groups: { key: "similar" | "ai" | "user"; label: string; items: RemovedPhoto[] }[] = [
    { key: "similar", label: "Removed as duplicate / similar", items: [] },
    { key: "ai",      label: "Removed by AI",                  items: [] },
    { key: "user",    label: "Removed by you",                 items: [] },
  ];
  for (const r of removed) {
    const cat = categorize(r);
    groups.find((g) => g.key === cat)!.items.push(r);
  }
  return (
    <div className="space-y-5">
      {groups.filter((g) => g.items.length > 0).map((g) => (
        <div key={g.key}>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {g.label}
            </span>
            <span className="text-[11px] text-muted-foreground">{g.items.length}</span>
          </div>
          <ul className="space-y-2">
            {g.items.map((r) => (
              <li key={r.photo.id} className="glass-card flex gap-3 rounded-2xl p-2">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                  <img
                    src={r.photo.previewUrl ?? r.photo.url}
                    alt=""
                    decoding="async"
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`chip ${
                          g.key === "similar"
                            ? "bg-lavender/60"
                            : g.key === "ai"
                              ? "bg-mint/40"
                              : "bg-coral/15 text-coral"
                        }`}
                      >
                        {g.key === "similar" ? "Similar" : g.key === "ai" ? "AI cut" : "You cut"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{r.photo.name}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-ink/80">{friendlyReason(r)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestore(r.photo.id)}
                    className="self-start chip bg-mint/60 text-ink"
                  >
                    <Undo2 className="h-3 w-3" /> Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ───────────── Final ───────────── */
function FinalStage() {
  const { state, dispatch } = useDumpDeck();
  const [ordering, setOrdering] = useState(false);

  function removeSlide(id: string) {
    const photo = state.finalOrder.find((p) => p.id === id);
    if (photo) {
      dispatch({
        type: "addRemoved",
        entries: [{ photo, reason: "Removed from final collection.", source: "user" }],
      });
    }
    dispatch({ type: "setFinalOrder", photos: state.finalOrder.filter((p) => p.id !== id) });
  }

  function runAiOrder() {
    setOrdering(true);
    setTimeout(() => {
      dispatch({ type: "setFinalOrder", photos: aiOrder(state.finalOrder, state.settings) });
      setOrdering(false);
      toast.success("AI ordered your post");
    }, 700);
  }

  return (
    <section>
      <Heading
        eyebrow="Step 6"
        title="Your final dump"
        body="Drag to reorder, or let AI build a balanced, dispersed flow."
      />

      <div className="mt-4 grid grid-cols-3 gap-2">
        <ScoreBadge label="Slides" value={state.finalOrder.length / 20} />
        <ScoreBadge
          label="Avg score"
          value={state.finalOrder.reduce((a, p) => a + p.overall, 0) / Math.max(1, state.finalOrder.length)}
        />
        <ScoreBadge label="Vibe" value={0.92} />
      </div>

      <Button
        onClick={runAiOrder}
        disabled={ordering}
        className="mt-5 h-12 w-full rounded-2xl bg-coral text-base font-semibold text-white shadow-lg hover:bg-coral/90"
      >
        <Wand2 className="mr-2 h-4 w-4" />
        {ordering ? "Arranging the flow…" : "AI order my post"}
      </Button>

      <div className="mt-5">
        <SortableGrid
          photos={state.finalOrder}
          onChange={(next) => dispatch({ type: "setFinalOrder", photos: next })}
          onRemove={removeSlide}
        />
      </div>

      <StickyAction>
        <Button
          onClick={() => dispatch({ type: "setStage", stage: "export" })}
          className="h-14 w-full rounded-2xl bg-ink text-base font-semibold text-cream hover:bg-coral"
        >
          Finalize & export →
        </Button>
      </StickyAction>
    </section>
  );
}

/* ───────────── Export ───────────── */
function ExportStage() {
  const { state, dispatch } = useDumpDeck();
  const [downloading, setDownloading] = useState(false);

  function removeSlide(id: string) {
    const photo = state.finalOrder.find((p) => p.id === id);
    if (photo) {
      dispatch({
        type: "addRemoved",
        entries: [{ photo, reason: "Removed from final post.", source: "user" }],
      });
    }
    dispatch({ type: "setFinalOrder", photos: state.finalOrder.filter((p) => p.id !== id) });
    toast("Removed from post");
  }

  async function download() {
    setDownloading(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < state.finalOrder.length; i++) {
        const p = state.finalOrder[i];
        const blob = await fetch(p.url).then((r) => r.blob());
        const ext = (p.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
        zip.file(`slide-${String(i + 1).padStart(2, "0")}.${ext}`, blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dumpdeck-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded! Time to post.");
    } catch {
      toast.error("Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  function save() {
    try {
      const data = state.finalOrder.map((p, i) => ({ slide: i + 1, name: p.name, tags: p.tags }));
      localStorage.setItem("dumpdeck:saved", JSON.stringify({ at: Date.now(), data }));
      toast.success("Collection saved to this browser.");
    } catch {
      toast.error("Couldn't save.");
    }
  }

  const aspect = FORMAT_ASPECT[state.settings.formats[0] ?? "portrait"];

  return (
    <section>
      <Heading
        eyebrow="Step 7"
        title="Ready to post"
        body={`${state.finalOrder.length} slide${state.finalOrder.length === 1 ? "" : "s"}, ordered for max scroll-stopping power. Tap × to remove any.`}
      />

      <div className="mt-5 flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-4 px-4">
        {state.finalOrder.map((p, i) => (
          <div key={p.id} className="relative w-[78%] shrink-0">
            <div className="relative overflow-hidden rounded-3xl bg-muted shadow-xl" style={{ aspectRatio: aspect }}>
              <img src={p.previewUrl ?? p.url} alt="" decoding="async" loading="lazy" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeSlide(p.id)}
                className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white shadow-lg transition active:scale-95"
                aria-label="Remove slide"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-ink">
                Slide {i + 1}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between px-1">
              <div className="flex flex-wrap gap-1">
                {p.tags.slice(0, 2).map((t) => (
                  <TagBadge key={t} tag={t} />
                ))}
              </div>
              <button
                onClick={() => removeSlide(p.id)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-coral"
              >
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {state.finalOrder.length === 0 && (
        <div className="glass-card mt-4 rounded-3xl p-6 text-center text-sm text-muted-foreground">
          You removed every slide. Go back and pick a few.
        </div>
      )}

      <CaptionIdeas />

      <div className="mt-6 space-y-2">

        <Button
          onClick={download}
          disabled={downloading || state.finalOrder.length === 0}
          className="h-14 w-full rounded-2xl bg-coral text-base font-semibold text-white shadow-lg hover:bg-coral/90"
        >
          <Download className="mr-2 h-4 w-4" />
          {downloading ? "Zipping…" : "Download ordered photos"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={save}
            className="h-12 rounded-2xl border-ink/15 bg-white/70 font-semibold"
          >
            <Save className="mr-2 h-4 w-4" /> Save collection
          </Button>
          <Button
            variant="outline"
            onClick={() => dispatch({ type: "setStage", stage: "final" })}
            className="h-12 rounded-2xl border-ink/15 bg-white/70 font-semibold"
          >
            ← Edit order
          </Button>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Heuristic on-device analysis — drop in a vision model for production-grade scoring.
      </p>
    </section>
  );
}

/* ───────────── Caption Ideas ───────────── */
function CaptionIdeas() {
  const { state } = useDumpDeck();
  const [seed, setSeed] = useState(0);
  const ideas = useMemo<CaptionIdea[]>(
    () => generateCaptions(state.finalOrder, state.settings.vibes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.finalOrder, state.settings.vibes, seed],
  );

  if (state.finalOrder.length === 0) return null;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Caption copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <span className="chip bg-lavender/25 text-ink">
            <MessageCircle className="h-3 w-3" /> Caption ideas
          </span>
          <h2 className="font-display mt-2 text-2xl leading-tight">Pick a caption</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Generated from your vibes and the tags in your final post. Tap to copy.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSeed((s) => s + 1)}
          className="chip"
          aria-label="Regenerate captions"
        >
          <RefreshCw className="h-3 w-3" /> Shuffle
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {ideas.map((idea, i) => (
          <button
            key={`${idea.label}-${i}`}
            type="button"
            onClick={() => copy(idea.text)}
            className="group w-full rounded-2xl border border-ink/10 bg-white/80 p-3 text-left shadow-sm transition hover:border-coral/40 hover:bg-white"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-coral">
                {idea.label}
              </span>
              <Copy className="h-3.5 w-3.5 text-muted-foreground transition group-hover:text-ink" />
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{idea.text}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────── Bits ───────────── */
function Heading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div>
      <span className="chip bg-coral/15 text-coral">
        <Sparkles className="h-3 w-3" /> {eyebrow}
      </span>
      <h1 className="font-display mt-3 text-4xl leading-[0.95]">{title}</h1>
      {body && <p className="mt-2 text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}

function StickyAction({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md px-4 pb-4 pt-3">
      <div className="rounded-3xl bg-gradient-to-t from-cream via-cream/95 to-cream/0 px-1 pb-1 pt-6">
        {children}
      </div>
    </div>
  );
}

function MiniStrip({
  remaining,
  focusIdx,
  onJump,
}: {
  remaining: Photo[];
  focusIdx: number;
  onJump: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="chip"
      >
        {open ? "Hide" : "Show"} all {remaining.length}
      </button>
      {open && (
        <div className="mt-2 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 no-scrollbar">
          {remaining.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onJump(i)}
              className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted transition ${
                i === focusIdx ? "ring-2 ring-coral scale-105" : "opacity-70"
              }`}
            >
              <img
                src={p.previewUrl ?? p.url}
                alt=""
                decoding="async"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
