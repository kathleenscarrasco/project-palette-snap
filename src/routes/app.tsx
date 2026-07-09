import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Pin,
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
import { nextAnalyzingTagline, rememberTagline } from "@/lib/dumpdeck/analyzing-taglines";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { DumpDeckProvider, useDumpDeck } from "@/lib/dumpdeck/store";
import { aiOrder, groupBestBadges } from "@/lib/dumpdeck/ai";
import {
  assignDuplicateClusters,
  buildDuplicateGroupsForPhotos,
  type DuplicateClusterInput,
} from "@/lib/dumpdeck/pipeline/duplicate-clustering";
import { organizePhotos } from "@/lib/dumpdeck/pipeline/organization";
import {
  getFinalDraftById,
  missingDraftFields,
  saveFinalDraft,
  savedDraftDebugSummary,
  type DuplicateDecisionDraft,
  type FinalDraftPayload,
} from "@/lib/dumpdeck/drafts";
import {
  removedByRanking,
  rankPhotos,
  rankingShortlist,
} from "@/lib/dumpdeck/pipeline/ranking-engine";
import {
  saveDuplicateClusterAssignments,
  savePhotoRankings,
} from "@/lib/dumpdeck/pipeline/metadata-cache";
import { persistProjectUploads } from "@/lib/dumpdeck/storage";
import type {
  Photo,
  PostFormat,
  RemovedPhoto,
  Settings,
  AnalysisStatus,
  UploadItem,
  VibeFocus,
} from "@/lib/dumpdeck/types";
import { UploadGrid } from "@/components/dumpdeck/upload-grid";
import { PhotoCard } from "@/components/dumpdeck/photo-card";
import { SortableGrid } from "@/components/dumpdeck/sortable-grid";
import { ScoreBadge } from "@/components/dumpdeck/score-badge";
import { TagBadge } from "@/components/dumpdeck/tag-badge";
import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";
import { useAuth } from "@/hooks/use-auth";
import { isLocalDevAuth } from "@/integrations/supabase/client";

const MAX_KEEP = 20;
const LOCAL_SCAN_CONCURRENCY = 5;

function analysisOf(photo: Photo) {
  return photo.unifiedAnalysis?.analysis;
}

function rankingScore(photo: Photo) {
  return analysisOf(photo)?.rankingScore ?? photo.overall;
}

function orderWithPinned(photos: Photo[], pinnedCoverId?: string | null) {
  if (!pinnedCoverId) return photos;
  const pinned = photos.find((photo) => photo.id === pinnedCoverId);
  if (!pinned) return photos;
  return [pinned, ...photos.filter((photo) => photo.id !== pinnedCoverId)];
}

function reasoningFor(photo: Photo) {
  return analysisOf(photo)?.reasoning ?? photo.reasons[0] ?? "";
}

function averagePhotoScore(photos: Photo[], scorer: (photo: Photo) => number) {
  if (!photos.length) return 0;
  return photos.reduce((sum, photo) => sum + scorer(photo), 0) / photos.length;
}

function vibeAlignmentScore(photo: Photo) {
  return (
    photo.ranking?.scoreBreakdown?.sceneTagMatch ??
    photo.ranking?.scoreBreakdown?.objectTagMatch ??
    photo.ranking?.signals?.tagMatch ??
    photo.scores.postWorthy
  );
}

function activeProjectId() {
  try {
    return sessionStorage.getItem("dumpdeck:activeProjectId");
  } catch {
    return null;
  }
}

function activeDraftId() {
  try {
    return sessionStorage.getItem("dumpdeck:activeDraftId");
  } catch {
    return null;
  }
}

function projectUploadCountKey(projectId: string) {
  return `dumpdeck:project:${projectId}:uploadCount`;
}

function safeSessionItem(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function countPendingUploadItems() {
  const raw = safeSessionItem("dumpdeck:pending");
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "FotoFairy — Build your collection" },
      {
        name: "description",
        content: "Upload, analyze, curate, order, and export your photo collection.",
      },
    ],
  }),
  errorComponent: AppError,
  component: () => (
    <DumpDeckProvider>
      <Shell />
      <Toaster position="top-center" richColors />
    </DumpDeckProvider>
  ),
});

function AppError({ error, reset }: { error?: Error; reset: () => void }) {
  console.error("[dumpdeck] /app route failed before workspace render", {
    message: error?.message,
    stack: error?.stack,
    projectId: safeSessionItem("dumpdeck:activeProjectId"),
    draftId: safeSessionItem("dumpdeck:activeDraftId"),
    pendingPhotoCount: countPendingUploadItems(),
    hasPendingUploadState: Boolean(safeSessionItem("dumpdeck:pending")),
    route: typeof window !== "undefined" ? window.location.pathname : "/app",
  });
  return (
    <main className="grid min-h-screen place-items-center px-5 text-center">
      <div className="max-w-sm">
        <BrandMark className="mx-auto h-12 w-12" />
        <h1 className="mt-4 font-display text-3xl">Sorting did not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The workspace hit a temporary issue before the upload flow could start.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="chip bg-ink text-cream">
            Try again
          </button>
          <Link to="/projects" className="chip">
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}

const STAGES = [
  "setup",
  "upload",
  "analyze",
  "similar",
  "results",
  "curate",
  "final",
  "export",
] as const;

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
  const { state, dispatch } = useDumpDeck();
  const { user, isAuthed, loading } = useAuth();
  const navigate = useNavigate();
  const [draftHydrationChecked, setDraftHydrationChecked] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthed) {
      setDraftHydrationChecked(true);
      return;
    }

    let cancelled = false;
    async function loadDraftToResume() {
      setDraftHydrationChecked(false);
      const raw = sessionStorage.getItem("dumpdeck:resumeDraft");
      const draftId = activeDraftId();
      const targetStage =
        sessionStorage.getItem("dumpdeck:resumeDraftStage") === "final" ? "final" : "export";
      try {
        let draft: FinalDraftPayload | null = null;
        if (draftId) {
          const saved = await getFinalDraftById(draftId);
          console.debug("[dumpdeck] app restore fetched saved draft", {
            action: "app_restore",
            user_id: user?.id,
            routeChosen: targetStage,
            ...savedDraftDebugSummary(saved),
          });
          draft = saved?.draftPayload ?? null;
        }
        if (!draft && raw) {
          draft = JSON.parse(raw) as FinalDraftPayload;
          console.debug("[dumpdeck] app restore using session draft fallback", {
            user_id: user?.id,
            project_id: draft.projectId,
            draft_id: draft.draftId,
            final_selected_photo_count: draft.finalOrder?.length ?? 0,
            final_order_photo_ids: draft.orderedPhotoIds ?? [],
            pinned_cover_photo_id: draft.pinnedCoverPhotoId ?? null,
            missing_data: missingDraftFields({
              id: draft.draftId ?? "session-draft",
              projectId: draft.projectId,
              orderedPhotoIds: draft.orderedPhotoIds,
              rejectedPhotoIds: draft.rejectedPhotoIds,
              duplicateDecisions: draft.duplicateDecisions,
              selectedPreferences: {
                ...draft.selectedPreferences,
                pinnedCoverPhotoId: draft.pinnedCoverPhotoId,
              },
              scoresReasons: draft.scoresReasons,
              draftPayload: draft,
              createdAt: draft.createdAt,
              updatedAt: draft.updatedAt,
              storage: "local",
            }),
          });
        }
        if (!draft) return;
        if (!Array.isArray(draft.finalOrder) || draft.finalOrder.length === 0) {
          console.warn("[dumpdeck] app restore missing final order", {
            draftId,
            projectId: activeProjectId(),
            hasSessionPayload: Boolean(raw),
          });
      toast.error("That draft is missing photo details. Start from the saved collection instead.");
          return;
        }
        if (cancelled) return;
        const finalOrder = orderWithPinned(draft.finalOrder, draft.pinnedCoverPhotoId);
        const removed = Array.isArray(draft.removed) ? draft.removed : [];
        dispatch({
          type: "hydrate",
          state: {
            stage: targetStage,
            settings: draft.selectedPreferences ?? { formats: ["portrait"], vibes: ["random"] },
            photos: mergeDraftPhotos(draft.uploadedPhotos, finalOrder, removed),
            shortlist: finalOrder,
            kept: finalOrder,
            finalOrder,
            removed,
            duplicateDecisions: draft.duplicateDecisions ?? [],
            pinnedCoverId: draft.pinnedCoverPhotoId ?? null,
          },
        });
        toast.success("Draft opened");
      } catch (err) {
        console.error("[dumpdeck] failed to resume draft", err);
        toast.error("Could not open that draft.");
      } finally {
        sessionStorage.removeItem("dumpdeck:resumeDraft");
        sessionStorage.removeItem("dumpdeck:resumeDraftStage");
        if (!cancelled) setDraftHydrationChecked(true);
      }
    }

    void loadDraftToResume();
    return () => {
      cancelled = true;
    };
  }, [dispatch, isAuthed, loading, user?.id]);

  if (loading || (isAuthed && !draftHydrationChecked)) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  if (!isAuthed) {
    return (
      <main className="grid min-h-screen place-items-center px-5 text-center">
        <div className="max-w-sm">
          <h1 className="font-display text-3xl">Sign in to start sorting</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your collections and sorting sessions are saved to your account.
          </p>
          <Link
            to="/auth"
            className="mt-5 inline-flex h-11 items-center rounded-xl bg-ink px-4 font-semibold text-cream"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (!activeProjectId()) {
    return (
      <main className="grid min-h-screen place-items-center px-5 text-center">
        <div className="max-w-sm">
          <BrandMark className="mx-auto h-12 w-12" />
          <h1 className="mt-4 font-display text-3xl">Choose a collection first</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            FotoFairy saves uploads, cuts, captions, and final order under a collection.
          </p>
          <div className="mt-5 grid gap-2">
            <button
              type="button"
              onClick={() => void navigate({ to: "/projects" })}
              className="h-11 rounded-xl bg-ink px-4 font-semibold text-cream"
            >
              Back to home
            </button>
            <Link to="/projects" className="chip justify-center">
              Saved collections
            </Link>
          </div>
        </div>
      </main>
    );
  }

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

function mergeDraftPhotos(
  uploadedPhotos: Photo[] | undefined,
  finalOrder: Photo[],
  removed: RemovedPhoto[],
) {
  const byId = new Map<string, Photo>();
  for (const photo of uploadedPhotos ?? []) byId.set(photo.id, photo);
  for (const photo of finalOrder) byId.set(photo.id, photo);
  for (const entry of removed) byId.set(entry.photo.id, entry.photo);
  return Array.from(byId.values());
}

function TopBar() {
  const { dispatch } = useDumpDeck();
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <header className="flex items-center justify-between">
      <Link to="/projects" className="flex items-center gap-2">
        <BrandMark className="h-9 w-9" />
        <BrandWordmark size="text-lg" />
      </Link>
      <button
        onClick={() => setConfirmReset(true)}
        className="chip"
        type="button"
      >
        <RotateCcw className="h-3 w-3" /> Reset
      </button>
      <AnimatePresence>
        {confirmReset && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-ink/35 px-5 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setConfirmReset(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="reset-flow-title"
              className="w-full max-w-sm rounded-3xl bg-cream p-6 text-center shadow-2xl"
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 12 }}
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="reset-flow-title" className="font-display text-3xl">
                Start over?
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                This clears the current in-progress sort on this device. Saved collections and
                drafts stay in your account.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  className="h-11 rounded-xl bg-white font-semibold text-ink ring-1 ring-ink/10"
                  onClick={() => setConfirmReset(false)}
                >
                  Keep sorting
                </button>
                <button
                  type="button"
                  className="h-11 rounded-xl bg-coral font-semibold text-white"
                  onClick={() => {
                    setConfirmReset(false);
                    dispatch({ type: "reset" });
                  }}
                >
                  Reset
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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

  const formatOpts: { id: PostFormat; label: string; ratio: string; box: string; grad: string }[] =
    [
      {
        id: "square",
        label: "Instagram square",
        ratio: "1 : 1",
        box: "h-14 w-14",
        grad: "bg-gradient-to-br from-coral to-butter",
      },
      {
        id: "portrait",
        label: "Portrait carousel",
        ratio: "4 : 5",
        box: "h-16 w-[3.2rem]",
        grad: "bg-gradient-to-br from-lavender to-mint",
      },
      {
        id: "landscape",
        label: "Landscape",
        ratio: "1.91 : 1",
        box: "h-10 w-[4.2rem]",
        grad: "bg-gradient-to-br from-mint to-butter",
      },
      {
        id: "story",
        label: "Story",
        ratio: "9 : 16",
        box: "h-16 w-9",
        grad: "bg-gradient-to-br from-coral to-lavender",
      },
    ];

  const vibeOpts: {
    id: VibeFocus;
    label: string;
    Icon: typeof Heart;
    hint: string;
    tile: string;
  }[] = [
    {
      id: "cute",
      label: "Cute",
      Icon: Heart,
      hint: "Soft, sweet moments",
      tile: "from-coral/80 to-butter/80",
    },
    {
      id: "aesthetic",
      label: "Aesthetic",
      Icon: Palette,
      hint: "Color, light, mood",
      tile: "from-lavender to-mint",
    },
    {
      id: "funny",
      label: "Funny",
      Icon: Laugh,
      hint: "Chaotic, candid",
      tile: "from-butter to-coral/70",
    },
    {
      id: "vacation",
      label: "Vacation",
      Icon: Palmtree,
      hint: "Travel + scenery",
      tile: "from-mint to-lavender",
    },
    {
      id: "food",
      label: "Food",
      Icon: UtensilsCrossed,
      hint: "Plates + details",
      tile: "from-coral/70 to-butter",
    },
    {
      id: "friends",
      label: "Friends",
      Icon: Users,
      hint: "People-first",
      tile: "from-mint to-butter",
    },
    {
      id: "random",
      label: "Random mix",
      Icon: Shuffle,
      hint: "A little of everything",
      tile: "from-lavender to-coral/70",
    },
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
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Post format
          </div>
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
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Post vibe
          </div>
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
async function makeLocalSampleUploads(): Promise<UploadItem[]> {
  const samples = [
    {
      name: "Brunch table",
      displayName: "Brunch table",
      colorA: "#ff7a59",
      colorB: "#f7d154",
      label: "food",
      seed: 0,
    },
    {
      name: "Brunch table copy",
      displayName: "Brunch table",
      colorA: "#ff7a59",
      colorB: "#f7d154",
      label: "food",
      seed: 0,
    },
    {
      name: "City night",
      displayName: "City night",
      colorA: "#223049",
      colorB: "#7cc6fe",
      label: "city",
      seed: 1,
    },
    {
      name: "Beach walk",
      displayName: "Beach walk",
      colorA: "#4db6ac",
      colorB: "#ffe08a",
      label: "beach",
      seed: 2,
    },
    {
      name: "Mountain view",
      displayName: "Mountain view",
      colorA: "#6c7a89",
      colorB: "#b8e0d2",
      label: "landscape",
      seed: 3,
    },
    {
      name: "Portrait smile",
      displayName: "Portrait smile",
      colorA: "#c084fc",
      colorB: "#ffd6a5",
      label: "friends",
      seed: 4,
    },
    {
      name: "Dog park",
      displayName: "Dog park",
      colorA: "#78c6a3",
      colorB: "#f4a261",
      label: "pets",
      seed: 5,
    },
    {
      name: "Gallery wall",
      displayName: "Gallery wall",
      colorA: "#f5f3ff",
      colorB: "#7c3aed",
      label: "aesthetic",
      seed: 6,
    },
    {
      name: "Coffee detail",
      displayName: "Coffee detail",
      colorA: "#8d6e63",
      colorB: "#ffe0b2",
      label: "food",
      seed: 7,
    },
    {
      name: "Hotel mirror",
      displayName: "Hotel mirror",
      colorA: "#f8bbd0",
      colorB: "#90caf9",
      label: "outfit",
      seed: 8,
    },
    {
      name: "Museum steps",
      displayName: "Museum steps",
      colorA: "#cfd8dc",
      colorB: "#ffab91",
      label: "city",
      seed: 9,
    },
    {
      name: "Sunset road",
      displayName: "Sunset road",
      colorA: "#ff8a65",
      colorB: "#5c6bc0",
      label: "travel",
      seed: 10,
    },
    {
      name: "Park picnic",
      displayName: "Park picnic",
      colorA: "#aed581",
      colorB: "#fff176",
      label: "friends",
      seed: 11,
    },
    {
      name: "Train window",
      displayName: "Train window",
      colorA: "#78909c",
      colorB: "#b3e5fc",
      label: "travel",
      seed: 12,
    },
    {
      name: "Dessert plate",
      displayName: "Dessert plate",
      colorA: "#f48fb1",
      colorB: "#fff59d",
      label: "food",
      seed: 13,
    },
    {
      name: "Concert blur",
      displayName: "Concert blur",
      colorA: "#311b92",
      colorB: "#f06292",
      label: "night",
      seed: 14,
    },
    {
      name: "Lake dock",
      displayName: "Lake dock",
      colorA: "#4fc3f7",
      colorB: "#a5d6a7",
      label: "landscape",
      seed: 15,
    },
    {
      name: "Bookstore corner",
      displayName: "Bookstore corner",
      colorA: "#bcaaa4",
      colorB: "#ffe082",
      label: "indoors",
      seed: 16,
    },
    {
      name: "Market flowers",
      displayName: "Market flowers",
      colorA: "#ec407a",
      colorB: "#81c784",
      label: "detail",
      seed: 17,
    },
    {
      name: "Airport snack",
      displayName: "Airport snack",
      colorA: "#90a4ae",
      colorB: "#ffcc80",
      label: "travel",
      seed: 18,
    },
  ];

  return Promise.all(
    samples.map(async (sample, index) => {
      const width = sample.seed % 2 === 0 ? 900 : 720;
      const height = sample.seed % 2 === 0 ? 1200 : 900;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable");

      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, sample.colorA);
      gradient.addColorStop(1, sample.colorB);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 0.2;
      for (let i = 0; i < 12; i++) {
        ctx.beginPath();
        ctx.arc(
          (((i + sample.seed) * 211) % width) + 40,
          (((i + sample.seed) * 157) % height) + 40,
          60 + (((i + sample.seed) * 23) % 110),
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#111827";
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.fillRect(72, height - 210, width - 144, 120);
      ctx.fillStyle = "#111827";
      ctx.font = "700 48px system-ui, sans-serif";
      ctx.fillText(sample.displayName, 108, height - 138);
      ctx.font = "500 28px system-ui, sans-serif";
      ctx.fillText(`Local ${sample.label} sample`, 108, height - 98);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error("Could not create sample"))),
          "image/jpeg",
          0.9,
        );
      });
      const url = URL.createObjectURL(blob);
      return {
        id: `local-sample-${index + 1}`,
        url,
        previewUrl: url,
        name: `${sample.name}.jpg`,
        width,
        height,
        fingerprint: `local-sample-${sample.seed}-${width}x${height}`,
        byteSize: blob.size,
        mimeType: blob.type,
        lastModified: Date.now() - index * 1000,
      };
    }),
  );
}

function UploadStage() {
  const { state, dispatch } = useDumpDeck();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(false);

  function handleAnalyze() {
    const pendingItems = [...items];
    if (!pendingItems.length) return;
    const projectId = activeProjectId();
    sessionStorage.setItem(
      "dumpdeck:pending",
      JSON.stringify(
        pendingItems.map((it) => ({
          id: it.id,
          url: it.url,
          originalFileUrl: it.originalFileUrl,
          previewFileUrl: it.previewFileUrl,
          previewUrl: it.previewUrl,
          storageBucket: it.storageBucket,
          originalStoragePath: it.originalStoragePath,
          previewStoragePath: it.previewStoragePath,
          fileName: it.fileName,
          uploadedAt: it.uploadedAt,
          name: it.name,
          width: it.width,
          height: it.height,
          fingerprint: it.fingerprint,
          byteSize: it.byteSize,
          mimeType: it.mimeType,
          originalMimeType: it.originalMimeType,
          convertedFromHeic: it.convertedFromHeic,
          conversionQuality: it.conversionQuality,
          conversionDecoder: it.conversionDecoder,
          originalByteSize: it.originalByteSize,
          previewByteSize: it.previewByteSize,
          lastModified: it.lastModified,
        })),
      ),
    );
    sessionStorage.setItem("dumpdeck:lastUploadCount", String(pendingItems.length));
    if (projectId) {
      sessionStorage.setItem(projectUploadCountKey(projectId), String(pendingItems.length));
      localStorage.setItem(projectUploadCountKey(projectId), String(pendingItems.length));
    }
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
          <span key={f} className="chip bg-lavender/40">
            {FORMAT_LABEL[f]}
          </span>
        ))}
        {state.settings.vibes.map((v) => (
          <span key={v} className="chip bg-mint/40">
            #{v}
          </span>
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
      {isLocalDevAuth && (
        <div className="mt-3">
          <button
            type="button"
            onClick={async () => {
              setLoadingSamples(true);
              try {
                setItems(await makeLocalSampleUploads());
                toast.success("Loaded local sample photos");
              } catch (err) {
                console.error("[dumpdeck] sample photo generation failed", err);
                toast.error("Could not load sample photos");
              } finally {
                setLoadingSamples(false);
              }
            }}
            disabled={loadingSamples}
            className="chip bg-mint/50 text-ink disabled:opacity-60"
          >
            {loadingSamples ? "Loading samples…" : "Use local sample photos"}
          </button>
        </div>
      )}
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
type AnalysisRow = {
  item: UploadItem;
  status: AnalysisStatus;
  photo?: Photo;
  clipEmbeddingVector?: number[];
  error?: string;
  attempts: number;
  geminiRequests: number;
  geminiCandidate?: boolean;
  localSkipReason?: string;
};

type AnalysisPhase = "loading" | "local-scanning" | "refining" | "ready" | "preparing" | "blocked";

type RefinementSnapshot = {
  waiting: AnalysisRow[];
  analyzing: AnalysisRow[];
  retrying: AnalysisRow[];
  completed: AnalysisRow[];
  failed: AnalysisRow[];
  skipped: AnalysisRow[];
  screenshots: AnalysisRow[];
  unsupported: AnalysisRow[];
};

type GeminiPhotoAudit = {
  id: string;
  name: string;
  reason: string;
  requests: number;
  retries: number;
  cache: "hit" | "miss" | "skipped" | "unknown";
  status: "analyzed" | "failed" | "cancelled" | "skipped";
  durationMs: number;
  error?: string;
};

type GeminiRefinementAudit = {
  requests: number;
  retries: number;
  failures: number;
  cacheHits: number;
  skippedReanalysis: number;
  startedAt: number;
  photos: GeminiPhotoAudit[];
};

type PipelineConfig = {
  analysisConcurrency: number;
  maxGeminiPhotos: number;
  geminiModel: string;
};

async function getPipelineConfig(): Promise<PipelineConfig> {
  try {
    const response = await fetch("/api/dumpdeck/pipeline-config");
    if (!response.ok) throw new Error(`Config request failed: ${response.status}`);
    const data = await response.json();
    const configured = Number(data.analysisConcurrency);
    return {
      analysisConcurrency: Number.isFinite(configured)
        ? Math.min(10, Math.max(1, Math.round(configured)))
        : 3,
      maxGeminiPhotos: Number.isFinite(Number(data.maxGeminiPhotos))
        ? Math.min(200, Math.max(0, Math.round(Number(data.maxGeminiPhotos))))
        : 70,
      geminiModel: typeof data.geminiModel === "string" ? data.geminiModel : "gemini-2.5-flash",
    };
  } catch (err) {
    console.warn("[dumpdeck] pipeline config unavailable; using defaults", err);
    return { analysisConcurrency: 3, maxGeminiPhotos: 70, geminiModel: "gemini-2.5-flash" };
  }
}

function isRetryableAnalysisError(err: unknown) {
  if (err && typeof err === "object" && "retryable" in err) {
    return Boolean((err as { retryable?: unknown }).retryable);
  }
  const message = err instanceof Error ? err.message : String(err);
  return /429|too.?many|resource_exhausted|rate limit|quota|temporar|timeout|network|upstream|unavailable|503|retry/i.test(
    message,
  );
}

function retryDelayMs(attempt: number, err?: unknown) {
  const providerDelay =
    err && typeof err === "object" && "retryAfterMs" in err
      ? Number((err as { retryAfterMs?: unknown }).retryAfterMs)
      : Number.NaN;
  if (Number.isFinite(providerDelay) && providerDelay > 0) return providerDelay + retryJitterMs();
  return [2000, 4000, 8000, 16000, 32000][Math.min(attempt - 1, 4)] + retryJitterMs();
}

function retryJitterMs() {
  return Math.round(300 + Math.random() * 900);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slowestStage(stages: Record<string, number>) {
  return Object.entries(stages).reduce(
    (slowest, [name, ms]) => (ms > slowest.ms ? { name, ms } : slowest),
    { name: "none", ms: 0 },
  );
}

function useAnalyzingTagline({
  items,
  photos,
  phase,
  active,
}: {
  items: UploadItem[];
  photos: Photo[];
  phase: AnalysisPhase;
  active: boolean;
}) {
  const tickRef = useRef(0);
  const latestRef = useRef({ items, photos, phase });
  const recentRef = useRef<string[]>([]);
  const [line, setLine] = useState(() => {
    const initial = nextAnalyzingTagline({
      items,
      photos,
      phase,
      tick: 0,
      recent: [],
    });
    recentRef.current = rememberTagline([], initial);
    return initial;
  });

  useEffect(() => {
    latestRef.current = { items, photos, phase };
  }, [items, photos, phase]);

  useEffect(() => {
    if (!active) return;
    const rotate = () => {
      tickRef.current += 1;
      const current = latestRef.current;
      const next = nextAnalyzingTagline({
        ...current,
        tick: tickRef.current,
        recent: recentRef.current,
      });
      setLine((previous) => {
        const safeNext =
          next === previous
            ? nextAnalyzingTagline({
                ...current,
                tick: tickRef.current + 17,
                recent: [previous, ...recentRef.current],
              })
            : next;
        recentRef.current = rememberTagline(recentRef.current, safeNext);
        return safeNext;
      });
    };
    const id = window.setInterval(rotate, 6000);
    return () => window.clearInterval(id);
  }, [active]);

  return line;
}

function localRemovalReason(photo: Photo) {
  const convertedFromHeic = photo.sourceMetadata?.convertedFromHeic;
  const sharpnessFloor = convertedFromHeic ? 0.07 : 0.12;
  if (
    photo.imageQuality?.sharpness !== undefined &&
    photo.imageQuality.sharpness < sharpnessFloor
  ) {
    return "Very blurry in quick scan.";
  }
  const brightness = photo.imageQuality?.signals.brightness ?? photo.analysis.brightness;
  if (brightness < 0.08) return "Extremely dark in quick scan.";
  if (brightness > 0.94) return "Extremely overexposed in quick scan.";
  if (looksLikeScreenshot(photo)) return "Likely screenshot/non-photo skipped before Gemini.";
  return "";
}

function looksLikeScreenshot(photo: Photo) {
  const name = photo.name.toLowerCase();
  if (/\bscreen\s?shot\b|screenshot|screen_recording|screen-recording/.test(name)) return true;
  const ratio = photo.width / Math.max(1, photo.height);
  const commonScreenRatio =
    Math.abs(ratio - 9 / 16) < 0.02 ||
    Math.abs(ratio - 16 / 9) < 0.02 ||
    Math.abs(ratio - 19.5 / 9) < 0.03;
  const objectLabels = new Set(
    (photo.detectedObjects ?? []).map((object) => object.labelNormalized),
  );
  const scene = photo.sceneAnalysis?.primaryScene.toLowerCase() ?? "";
  const textOrUi =
    objectLabels.has("text") || objectLabels.has("screen") || objectLabels.has("button");
  return (
    scene.includes("screenshot") ||
    scene.includes("screen") ||
    scene.includes("receipt") ||
    scene.includes("document") ||
    scene.includes("meme") ||
    objectLabels.has("receipt") ||
    objectLabels.has("document") ||
    (commonScreenRatio &&
      ((photo.analysis.saturation < 0.2 && photo.analysis.contrast > 0.5) || textOrUi) &&
      photo.analysis.sharpness > 0.5)
  );
}

function chooseGeminiCandidates(rows: AnalysisRow[], maxGeminiPhotos: number) {
  if (maxGeminiPhotos <= 0) return [];
  const eligible = rows.filter((row) => row.status === "local_complete" && row.photo);
  const scored = eligible.map((row) => {
    const photo = row.photo!;
    const quality = photo.imageQuality?.overallTechnicalQuality ?? photo.scores.quality;
    const uncertain =
      (photo.photoTypeConfidence < 0.58 ? 0.18 : 0) +
      (photo.analysis.peopleUnsure ? 0.16 : 0) +
      (photo.photoType === "random" ? 0.12 : 0);
    const semanticNeed = photo.tags.some((tag) =>
      ["Food", "Landscape", "Selfie", "Group", "Unsure"].includes(tag),
    )
      ? 0.14
      : 0;
    const tagNeed = row.photo
      ? photoScoreForTags(photo, row.photo.unifiedAnalysis?.analysis.objects.length ?? 0)
      : 0;
    return {
      row,
      score: photo.overall * 0.45 + quality * 0.24 + uncertain + semanticNeed + tagNeed,
    };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(maxGeminiPhotos, scored.length))
    .map((entry) => entry.row);
}

function geminiCandidateReason(row: AnalysisRow) {
  const photo = row.photo;
  if (!photo) return "semantic refinement needed";
  const reasons: string[] = [];
  const quality = photo.imageQuality?.overallTechnicalQuality ?? photo.scores.quality;
  if (photo.photoTypeConfidence < 0.58) reasons.push("uncertain local scene/type");
  if (photo.analysis.peopleUnsure) reasons.push("people/face signal needs confirmation");
  if (photo.tags.some((tag) => ["Food", "Landscape", "Selfie", "Group", "Unsure"].includes(tag))) {
    reasons.push("semantic tag confirmation");
  }
  if (photo.overall >= 0.62 || quality >= 0.62) reasons.push("likely finalist");
  if (
    photo.photoType === "detail" ||
    photo.photoType === "food" ||
    photo.photoType === "landscape"
  ) {
    reasons.push("non-people aesthetic/detail candidate");
  }
  return reasons.length ? reasons.join("; ") : "selected for deeper Gemini refinement";
}

function photoScoreForTags(photo: Photo, objectCount: number) {
  const tags = photo.tags.join(" ").toLowerCase();
  let score = 0;
  if (tags.includes("food") || photo.photoType === "food") score += 0.1;
  if (tags.includes("landscape") || photo.photoType === "landscape") score += 0.08;
  if (photo.peopleCount > 0) score += 0.08;
  if (objectCount === 0 && photo.photoType === "random") score += 0.04;
  return score;
}

function isScreenshotSkipReason(reason?: string) {
  return /screenshot|screen|non-photo|receipt|document|meme/i.test(reason ?? "");
}

function isUnsupportedSkipReason(reason?: string) {
  return /unsupported|corrupt|couldn't|failed|invalid/i.test(reason ?? "");
}

function summarizeSkippedRows(
  skippedRows: AnalysisRow[],
  screenshotRows: AnalysisRow[],
  unsupportedRows: AnalysisRow[],
) {
  if (!skippedRows.length) return "";
  const parts: string[] = [];
  if (screenshotRows.length > 0) {
    parts.push(
      `${screenshotRows.length} screenshot/non-photo ${
        screenshotRows.length === 1 ? "was" : "were"
      } excluded automatically`,
    );
  }
  if (unsupportedRows.length > 0) {
    parts.push(
      `${unsupportedRows.length} unsupported or failed ${
        unsupportedRows.length === 1 ? "image was" : "images were"
      } skipped`,
    );
  }
  const explainedIds = new Set([...screenshotRows, ...unsupportedRows].map((row) => row.item.id));
  const remaining = skippedRows.filter((row) => !explainedIds.has(row.item.id));
  const duplicateCount = remaining.filter((row) =>
    /exact duplicate|duplicate/i.test(row.localSkipReason ?? row.error ?? ""),
  ).length;
  if (duplicateCount > 0) {
    parts.push(
      `${duplicateCount} exact duplicate ${duplicateCount === 1 ? "was" : "were"} skipped`,
    );
  }
  const otherCount = remaining.length - duplicateCount;
  if (otherCount > 0) {
    const firstOther = remaining.find(
      (row) => !/exact duplicate|duplicate/i.test(row.localSkipReason ?? row.error ?? ""),
    );
    const firstReason = firstOther?.localSkipReason ?? firstOther?.error;
    parts.push(
      firstReason
        ? `${otherCount} photo${otherCount === 1 ? "" : "s"} skipped: ${firstReason}`
        : `${otherCount} photo${otherCount === 1 ? "" : "s"} skipped`,
    );
  }
  return parts.join(" · ");
}

function photoAccountingSummary(
  total: number,
  usable: number,
  skipped: number,
  failed: number,
) {
  const accounted = usable + skipped + failed;
  if (accounted >= total) {
    const details = [`${usable} usable`];
    if (skipped) details.push(`${skipped} skipped`);
    if (failed) details.push(`${failed} failed`);
    return `All ${total} photo${total === 1 ? "" : "s"} accounted for · ${details.join(" · ")}`;
  }
  return `${usable} usable photo${usable === 1 ? "" : "s"} found`;
}

function refinementSnapshot(rows: AnalysisRow[]): RefinementSnapshot {
  const skipped = rows.filter((row) => row.status === "skipped");
  return {
    waiting: rows.filter((row) => row.status === "queued"),
    analyzing: rows.filter((row) => row.status === "analyzing"),
    retrying: rows.filter((row) => row.status === "retrying"),
    completed: rows.filter((row) => row.geminiCandidate && row.status === "analyzed"),
    failed: rows.filter((row) => row.status === "failed"),
    skipped,
    screenshots: skipped.filter((row) => isScreenshotSkipReason(row.localSkipReason ?? row.error)),
    unsupported: rows.filter(
      (row) =>
        row.status === "failed" ||
        (row.status === "skipped" && isUnsupportedSkipReason(row.localSkipReason ?? row.error)),
    ),
  };
}

function logRefinementSnapshot(
  label: string,
  rows: AnalysisRow[],
  extra: Record<string, unknown> = {},
) {
  const snapshot = refinementSnapshot(rows);
  console.debug(`[dumpdeck] ${label}`, {
    remainingGeminiRequests:
      snapshot.waiting.length + snapshot.analyzing.length + snapshot.retrying.length,
    photosWaitingForRefinement: snapshot.waiting.map((row) => ({
      id: row.item.id,
      name: row.item.name,
      reason: row.error,
    })),
    currentlyAnalyzing: snapshot.analyzing.map((row) => ({
      id: row.item.id,
      name: row.item.name,
      attempts: row.attempts,
      geminiRequests: row.geminiRequests,
    })),
    retries: snapshot.retrying.map((row) => ({
      id: row.item.id,
      name: row.item.name,
      attempts: row.attempts,
      geminiRequests: row.geminiRequests,
      error: row.error,
    })),
    cacheHits: snapshot.completed.filter((row) => row.geminiRequests === 0).length,
    photosSkipped: snapshot.skipped.length,
    screenshotsOrNonPhotos: snapshot.screenshots.length,
    unsupportedOrFailed: snapshot.unsupported.length,
    totalRemainingWork:
      snapshot.waiting.length +
      snapshot.analyzing.length +
      snapshot.retrying.length +
      snapshot.failed.length,
    ...extra,
  });
}

function AnalyzeStage() {
  const { state, dispatch } = useDumpDeck();
  const [progress, setProgress] = useState(0);
  const [sample, setSample] = useState<{ url: string; previewUrl?: string }[]>([]);
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [phase, setPhase] = useState<AnalysisPhase>("loading");
  const [imagePipelineVersion, setImagePipelineVersion] = useState("");
  const [analysisConcurrency, setAnalysisConcurrency] = useState(3);
  const [maxGeminiPhotos, setMaxGeminiPhotos] = useState(70);
  const runIdRef = useRef(0);
  const rowsRef = useRef<AnalysisRow[]>([]);
  const pendingItemsRef = useRef<UploadItem[]>([]);
  const analysisStartedAtRef = useRef(0);
  const localScanStartedAtRef = useRef(0);
  const localScanDurationMsRef = useRef(0);
  const meaningfulReadyAtRef = useRef(0);
  const storageUploadRef = useRef({ uploaded: 0, durationMs: 0, failed: false });

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  function updateRows(updater: (current: AnalysisRow[]) => AnalysisRow[]) {
    setRows((current) => {
      const next = updater(current);
      rowsRef.current = next;
      return next;
    });
  }

  function mergeStoredUploads(storedItems: UploadItem[]) {
    const byId = new Map(storedItems.map((item) => [item.id, item] as const));
    updateRows((current) =>
      current.map((row) => {
        const stored = byId.get(row.item.id);
        if (!stored) return row;
        const nextItem = {
          ...row.item,
          storageBucket: stored.storageBucket,
          originalStoragePath: stored.originalStoragePath,
          previewStoragePath: stored.previewStoragePath,
          fileName: stored.fileName,
          uploadedAt: stored.uploadedAt,
        };
        const nextPhoto = row.photo
          ? {
              ...row.photo,
              storageBucket: stored.storageBucket,
              originalStoragePath: stored.originalStoragePath,
              previewStoragePath: stored.previewStoragePath,
              fileName: stored.fileName,
              uploadedAt: stored.uploadedAt,
              sourceMetadata: {
                ...row.photo.sourceMetadata,
                storageBucket: stored.storageBucket,
                originalStoragePath: stored.originalStoragePath,
                previewStoragePath: stored.previewStoragePath,
                fileName: stored.fileName,
                uploadedAt: stored.uploadedAt,
              },
            }
          : row.photo;
        return { ...row, item: nextItem, photo: nextPhoto };
      }),
    );
  }

  const analyzedCount = rows.filter((row) => row.status === "analyzed").length;
  const failedRows = rows.filter((row) => row.status === "failed");
  const skippedRows = rows.filter((row) => row.status === "skipped");
  const screenshotRows = skippedRows.filter((row) =>
    isScreenshotSkipReason(row.localSkipReason ?? row.error),
  );
  const unsupportedRows = rows.filter(
    (row) =>
      row.status === "failed" ||
      (row.status === "skipped" && isUnsupportedSkipReason(row.localSkipReason ?? row.error)),
  );
  const backgroundRefiningCount = rows.filter(
    (row) => row.geminiCandidate && ["queued", "analyzing", "retrying"].includes(row.status),
  ).length;
  const scannedCount = rows.filter(
    (row) =>
      Boolean(row.photo?.analysis) ||
      ["local_complete", "analyzed", "skipped", "failed"].includes(row.status),
  ).length;
  const localCompleteCount = rows.filter(
    (row) => row.status === "local_complete" || row.status === "analyzed",
  ).length;
  const retryingCount = rows.filter((row) => row.status === "retrying").length;
  const geminiCandidateCount = rows.filter((row) => row.geminiCandidate).length;
  const usableCount = rows.filter(
    (row) => row.photo?.analysis && row.status !== "failed" && row.status !== "skipped",
  ).length;
  const skippedReasonSummary = summarizeSkippedRows(skippedRows, screenshotRows, unsupportedRows);
  const accountedCount = rows.filter(
    (row) =>
      Boolean(row.photo?.analysis) ||
      row.status === "skipped" ||
      row.status === "failed" ||
      row.status === "analyzed",
  ).length;
  const mainProgress = rows.length
    ? Math.min(1, accountedCount / Math.max(1, rows.length))
    : Math.min(1, progress);
  const hasActiveAnalysis = rows.some(
    (row) =>
      row.status === "local_scanning" ||
      row.status === "queued" ||
      row.status === "analyzing" ||
      row.status === "retrying",
  );
  const canStartSorting =
    rows.length > 0 && phase !== "loading" && phase !== "local-scanning" && usableCount >= 4;

  const progressLabel =
    phase === "preparing"
      ? "Preparing your collection…"
      : phase === "local-scanning"
        ? `Scanning ${Math.min(scannedCount + 1, rows.length)} of ${rows.length} photos`
      : phase === "refining" && retryingCount > 0
        ? "Taking a little longer on the best candidates…"
      : phase === "refining"
        ? "Picking out the hidden gems…"
      : canStartSorting
        ? "Ready to sort!"
      : hasActiveAnalysis
        ? `Scanning ${Math.min(scannedCount + 1, rows.length)} of ${rows.length} photos`
      : failedRows.length
        ? `${failedRows.length} photo${failedRows.length === 1 ? "" : "s"} couldn't be scanned`
        : "Preparing analysis…";
  const progressDetail =
    rows.length > 0 ? photoAccountingSummary(rows.length, usableCount, skippedRows.length, failedRows.length) : "";
  const taglinePhotos = useMemo(
    () => rows.map((row) => row.photo).filter((photo): photo is Photo => !!photo),
    [rows],
  );
  const friendlyLine = useAnalyzingTagline({
    items: pendingItemsRef.current,
    photos: taglinePhotos,
    phase,
    active: hasActiveAnalysis || phase === "local-scanning" || phase === "refining",
  });

  async function analyzeRows(
    items: UploadItem[],
    runId = runIdRef.current,
    concurrency = analysisConcurrency,
  ) {
    if (!items.length) return;
    analysisStartedAtRef.current = performance.now();
    const pipeline = await import("@/lib/dumpdeck/pipeline");
    setImagePipelineVersion(pipeline.imagePipelineVersion);

    const localRows = await runLocalScan(items, runId, pipeline);
    if (runIdRef.current !== runId) return;

    const candidates = chooseGeminiCandidates(localRows, maxGeminiPhotos);
    const candidateIds = new Set(candidates.map((row) => row.item.id));
    const candidateReasons = new Map(
      candidates.map((row) => [row.item.id, geminiCandidateReason(row)]),
    );
    const rowsAfterCandidateSelection = rowsRef.current.map((row) => {
      if (!candidateIds.has(row.item.id)) {
        return row.status === "local_complete" ? { ...row, status: "analyzed" } : row;
      }
      return {
        ...row,
        status: "queued",
        geminiCandidate: true,
        error: candidateReasons.get(row.item.id),
        attempts: 0,
        geminiRequests: 0,
      };
    });
    rowsRef.current = rowsAfterCandidateSelection;
    setRows(rowsAfterCandidateSelection);

    const readyRows = rowsAfterCandidateSelection.filter(
      (row) => row.photo?.analysis && row.status !== "failed" && row.status !== "skipped",
    );
    meaningfulReadyAtRef.current = performance.now();

    console.debug("[dumpdeck] quick scan complete", {
      totalUploaded: items.length,
      uniqueLocalPhotos: localRows.filter((row) => row.status !== "skipped").length,
      photosHandledOnlyByLocalScan: localRows.filter((row) => !candidateIds.has(row.item.id))
        .length,
      geminiCandidateIds: candidates.map((row) => row.item.id),
      geminiCandidateReasons: candidates.map((row) => ({
        id: row.item.id,
        name: row.item.name,
        reason: candidateReasons.get(row.item.id),
      })),
      maxGeminiPhotos,
      selectedTags: state.settings.vibes,
      localScanTimeMs: localScanDurationMsRef.current,
      usablePhotosReady: readyRows.length,
    });
    console.debug("[dumpdeck] skipped Gemini calls", {
      skipped: localRows
        .filter((row) => !candidateIds.has(row.item.id))
        .map((row) => ({
          id: row.item.id,
          name: row.item.name,
          reason: row.localSkipReason || "local quick scan was confident enough",
          photoType: row.photo?.photoType,
          score: row.photo?.overall,
        })),
    });
    logRefinementSnapshot("remaining refinement work after quick scan", rowsRef.current, {
      totalUploaded: items.length,
      localScanTimeMs: localScanDurationMsRef.current,
      photosSelectedForGemini: candidates.length,
      photosReadyNow: readyRows.length,
      skippedBeforeGemini: rowsRef.current.filter((row) => row.status === "skipped").length,
    });

    if (!candidates.length) {
      setPhase(readyRows.length >= 4 ? "ready" : "blocked");
      return;
    }

    setPhase(readyRows.length >= 4 ? "ready" : "blocked");

    void runGeminiQueue(
      candidates.map((row) => row.item),
      runId,
      pipeline,
      concurrency,
      candidateReasons,
    ).then((audit) => {
      const totalRefinementTimeMs = Math.round(performance.now() - audit.startedAt);
      const totalUploadTimeMs = Math.round(performance.now() - analysisStartedAtRef.current);
      const meaningfulReadyTimeMs = Math.round(
        meaningfulReadyAtRef.current - analysisStartedAtRef.current,
      );
      const unnecessaryWaitingAvoidedMs = Math.max(0, totalUploadTimeMs - meaningfulReadyTimeMs);
      console.debug("[dumpdeck] Gemini refinement audit", {
        totalUploadedPhotos: items.length,
        totalUploadTimeMs,
        localScanTimeMs: localScanDurationMsRef.current,
        geminiRefinementTimeMs: totalRefinementTimeMs,
        meaningfulReadyTimeMs,
        unnecessaryWaitingAvoidedMs,
        photosHandledOnlyByLocalScan: Math.max(0, localRows.length - candidates.length),
        photosSentToGemini: candidates.length,
        totalGeminiRequests: audit.requests,
        retries: audit.retries,
        failures: audit.failures,
        photosSkipped: rowsRef.current.filter((row) => row.status === "skipped").length,
        screenshotsSkipped: rowsRef.current.filter((row) =>
          isScreenshotSkipReason(row.localSkipReason ?? row.error),
        ).length,
        cacheHits: audit.cacheHits,
        skippedReanalysis: audit.skippedReanalysis,
        duplicateGeminiCalls: audit.photos.filter((photo) => photo.requests > 1).length,
        averageGeminiRequestsPerPhoto: candidates.length
          ? Number((audit.requests / candidates.length).toFixed(2))
          : 0,
        reasonEachPhotoWasSent: audit.photos.map((photo) => ({
          id: photo.id,
          name: photo.name,
          reason: photo.reason,
          requests: photo.requests,
          retries: photo.retries,
          cache: photo.cache,
          status: photo.status,
          error: photo.error,
        })),
      });
      console.debug("[perf] upload analysis batch summary", {
        totalPhotosSelected: items.length,
        totalPhotosUploadedToStorage: storageUploadRef.current.uploaded,
        totalPhotosScannedLocally: localRows.length,
        totalPhotosSentToGemini: candidates.length,
        totalGeminiRequests: audit.requests,
        retries: audit.retries,
        cacheHits: audit.cacheHits,
        totalTimeMs: totalUploadTimeMs,
        stages: {
          localScanMs: localScanDurationMsRef.current,
          geminiRefinementMs: totalRefinementTimeMs,
          meaningfulReadyMs: meaningfulReadyTimeMs,
          backgroundStorageUploadMs: storageUploadRef.current.durationMs,
        },
        slowestStage: slowestStage({
          localScanMs: localScanDurationMsRef.current,
          geminiRefinementMs: totalRefinementTimeMs,
          meaningfulReadyMs: meaningfulReadyTimeMs,
          backgroundStorageUploadMs: storageUploadRef.current.durationMs,
        }),
      });
      logRefinementSnapshot(
        "remaining refinement work after Gemini queue settled",
        rowsRef.current,
      );
      if (runIdRef.current !== runId) return;
      if (
        rowsRef.current.filter((row) => row.photo?.analysis && row.status !== "failed").length < 4
      ) {
        setPhase("blocked");
      }
    });
  }

  async function runLocalScan(
    items: UploadItem[],
    runId: number,
    pipeline: typeof import("@/lib/dumpdeck/pipeline"),
  ) {
    setPhase("local-scanning");
    localScanStartedAtRef.current = performance.now();
    const seenFingerprints = new Set<string>();
    const workItems: UploadItem[] = [];

    for (const item of items) {
      const exactDuplicate = item.fingerprint && seenFingerprints.has(item.fingerprint);
      if (item.fingerprint) seenFingerprints.add(item.fingerprint);
      if (exactDuplicate) {
        updateRows((current) =>
          current.map((row) =>
            row.item.id === item.id
              ? {
                  ...row,
                  status: "skipped",
                  localSkipReason: "Exact duplicate detected during quick scan.",
                  error: "Exact duplicate skipped before Gemini.",
                }
              : row,
          ),
        );
        updateLocalScanProgress(items.length);
        continue;
      }
      workItems.push(item);
    }

    let cursor = 0;
    async function worker() {
      while (cursor < workItems.length && runIdRef.current === runId) {
        const item = workItems[cursor++];
        await scanOneLocalItem(item);
      }
    }

    async function scanOneLocalItem(item: UploadItem) {
      updateRows((current) =>
        current.map((row) =>
          row.item.id === item.id ? { ...row, status: "local_scanning" } : row,
        ),
      );
      try {
        const { photo, clipEmbeddingVector } = await pipeline.processLocalImage({
          ...item,
          settings: state.settings,
        });
        const localSkipReason = localRemovalReason(photo);
        updateRows((current) =>
          current.map((row) =>
            row.item.id === item.id
              ? {
                  ...row,
                  status: localSkipReason ? "skipped" : "local_complete",
                  photo,
                  clipEmbeddingVector,
                  localSkipReason,
                  error: localSkipReason,
                }
              : row,
          ),
        );
        if (item.convertedFromHeic) {
          console.debug("[dumpdeck] HEIC quick scan completed", {
            id: item.id,
            name: item.name,
            conversionQuality: item.conversionQuality,
            conversionDecoder: item.conversionDecoder,
            sharpness: photo.imageQuality?.sharpness,
            technicalQuality: photo.imageQuality?.overallTechnicalQuality,
            localSkipReason,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Local quick scan failed";
        updateRows((current) =>
          current.map((row) =>
            row.item.id === item.id
              ? {
                  ...row,
                  status: "failed",
                  error: message,
                }
              : row,
          ),
        );
      } finally {
        const completed = rowsRef.current.filter((row) =>
          ["local_complete", "analyzed", "skipped", "failed"].includes(row.status),
        ).length;
        updateLocalScanProgress(items.length, completed);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(LOCAL_SCAN_CONCURRENCY, Math.max(1, workItems.length)) }, () =>
        worker(),
      ),
    );

    localScanDurationMsRef.current = Math.round(performance.now() - localScanStartedAtRef.current);
    return rowsRef.current.filter((row) => row.photo && row.status === "local_complete");
  }

  function updateLocalScanProgress(total: number, completedOverride?: number) {
    const completed =
      completedOverride ??
      rowsRef.current.filter((row) =>
        ["local_complete", "analyzed", "skipped", "failed"].includes(row.status),
      ).length;
    const p = Math.min(0.5, (completed / Math.max(1, total)) * 0.5);
    setProgress(p);
  }

  async function runGeminiQueue(
    items: UploadItem[],
    runId: number,
    pipeline: typeof import("@/lib/dumpdeck/pipeline"),
    initialConcurrency: number,
    candidateReasons: Map<string, string>,
  ) {
    const pending = [...items];
    let active = 0;
    let currentConcurrency = Math.max(1, initialConcurrency);
    const audit: GeminiRefinementAudit = {
      requests: 0,
      retries: 0,
      failures: 0,
      cacheHits: 0,
      skippedReanalysis: 0,
      startedAt: performance.now(),
      photos: [],
    };

    return new Promise<GeminiRefinementAudit>((resolve) => {
      const pump = () => {
        if (runIdRef.current !== runId) {
          resolve(audit);
          return;
        }
        while (active < currentConcurrency && pending.length) {
          const item = pending.shift()!;
          const row = rowsRef.current.find((entry) => entry.item.id === item.id);
          if (!row || row.status === "skipped" || row.status === "failed") {
            audit.photos.push({
              id: item.id,
              name: item.name,
              reason: "Skipped before Gemini because the photo was no longer eligible.",
              requests: 0,
              retries: 0,
              cache: "skipped",
              status: "skipped",
              durationMs: 0,
              error: row?.error,
            });
            continue;
          }
          active += 1;
          void analyzeGeminiCandidate(
            item,
            runId,
            pipeline,
            candidateReasons.get(item.id) ?? "candidate-semantic-refinement",
          )
            .then((result) => {
              if (!result) return;
              audit.photos.push(result.audit);
              audit.requests += result.audit.requests;
              audit.retries += result.audit.retries;
              if (result.audit.status === "failed") audit.failures += 1;
              if (result.audit.cache === "hit") {
                audit.cacheHits += 1;
                audit.skippedReanalysis += 1;
              }
              if (result.queueSignal === "rate-limited") currentConcurrency = 1;
            })
            .finally(() => {
              active -= 1;
              const remainingActive = rowsRef.current.some(
                (row) =>
                  row.status === "queued" ||
                  row.status === "analyzing" ||
                  row.status === "retrying",
              );
              updateRefinedProgress();
              if (!pending.length && active === 0 && !remainingActive) {
                resolve(audit);
              } else {
                pump();
              }
            });
        }
        if (!pending.length && active === 0) {
          resolve(audit);
        }
      };
      pump();
    });
  }

  async function analyzeGeminiCandidate(
    item: UploadItem,
    runId: number,
    pipeline: typeof import("@/lib/dumpdeck/pipeline"),
    reason: string,
  ) {
    let sawRateLimit = false;
    let actualRequests = 0;
    let retryCount = 0;
    let cacheState: GeminiPhotoAudit["cache"] = "unknown";
    const startedAt = performance.now();
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (runIdRef.current !== runId) {
        return {
          queueSignal: sawRateLimit ? "rate-limited" : "cancelled",
          audit: {
            id: item.id,
            name: item.name,
            reason,
            requests: actualRequests,
            retries: retryCount,
            cache: cacheState,
            status: "cancelled" as const,
            durationMs: Math.round(performance.now() - startedAt),
          },
        };
      }
      updateRows((current) =>
        current.map((row) =>
          row.item.id === item.id
            ? {
                ...row,
                status: "analyzing",
                attempts: attempt,
                error: attempt === 1 ? undefined : row.error,
              }
            : row,
        ),
      );

      try {
        const { photo, clipEmbeddingVector, cache } = await pipeline.processImage({
          ...item,
          settings: state.settings,
          geminiRequestMeta: {
            photoId: item.id,
            photoName: item.name,
            reason,
            retryCount: attempt - 1,
          },
        });
        cacheState = cache === "hit" || cache === "miss" || cache === "skipped" ? cache : "unknown";
        if (cacheState !== "hit") actualRequests += 1;
        if (runIdRef.current !== runId) {
          return {
            queueSignal: sawRateLimit ? "rate-limited" : "cancelled",
            audit: {
              id: item.id,
              name: item.name,
              reason,
              requests: actualRequests,
              retries: retryCount,
              cache: cacheState,
              status: "cancelled" as const,
              durationMs: Math.round(performance.now() - startedAt),
            },
          };
        }
        updateRows((current) =>
          current.map((row) =>
            row.item.id === item.id
              ? {
                  ...row,
                  status: "analyzed",
                  photo,
                  clipEmbeddingVector,
                  error: undefined,
                  attempts: attempt,
                  geminiRequests: actualRequests,
                }
              : row,
          ),
        );
        console.debug("[dumpdeck] photo analysis complete", {
          id: item.id,
          name: item.name,
          reason,
          cache,
          attempts: attempt,
          actualGeminiRequests: actualRequests,
          retries: retryCount,
          geminiAnalysisTimeMs: Math.round(performance.now() - startedAt),
        });
        return {
          queueSignal: sawRateLimit ? "rate-limited" : "ok",
          audit: {
            id: item.id,
            name: item.name,
            reason,
            requests: actualRequests,
            retries: retryCount,
            cache: cacheState,
            status: "analyzed" as const,
            durationMs: Math.round(performance.now() - startedAt),
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Analysis failed";
        const retryable = isRetryableAnalysisError(err);
        actualRequests += 1;
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status?: unknown }).status
            : undefined;
        if (status === 429 || /429|resource_exhausted|too.?many|quota/i.test(message)) {
          sawRateLimit = true;
        }
        console.warn("[dumpdeck] photo analysis attempt failed", {
          id: item.id,
          name: item.name,
          reason,
          attempt,
          retryable,
          message,
        });
        if (runIdRef.current !== runId) return;
        const localResultIsEnough =
          sawRateLimit &&
          meaningfulReadyAtRef.current > 0 &&
          rowsRef.current.filter(
            (row) => row.photo?.analysis && row.status !== "failed" && row.status !== "skipped",
          ).length >= 4;
        if (localResultIsEnough) {
          updateRows((current) =>
            current.map((row) =>
              row.item.id === item.id
                ? {
                    ...row,
                    status: "analyzed",
                    attempts: attempt,
                    geminiRequests: actualRequests,
                    error: undefined,
                  }
                : row,
            ),
          );
          console.debug("[dumpdeck] skipped low-impact Gemini retry", {
            id: item.id,
            name: item.name,
            reason,
            message,
            localAnalysisAvailable: true,
          });
          return {
            queueSignal: "rate-limited",
            audit: {
              id: item.id,
              name: item.name,
              reason: `${reason}; background refinement skipped after rate limit`,
              requests: actualRequests,
              retries: retryCount,
              cache: cacheState,
              status: "skipped" as const,
              durationMs: Math.round(performance.now() - startedAt),
              error: message,
            },
          };
        }
        if (retryable && attempt < 5) {
          const waitMs = sawRateLimit
            ? Math.max(30000, retryDelayMs(attempt, err))
            : retryDelayMs(attempt, err);
          updateRows((current) =>
            current.map((row) =>
              row.item.id === item.id
                ? {
                    ...row,
                    status: "retrying",
                    attempts: attempt,
                    geminiRequests: actualRequests,
                    error: `${message} Retrying in ${Math.ceil(waitMs / 1000)}s.`,
                  }
                : row,
            ),
          );
          retryCount += 1;
          await sleep(waitMs);
          continue;
        }
        updateRows((current) =>
          current.map((row) =>
            row.item.id === item.id
              ? {
                  ...row,
                  status: "failed",
                  attempts: attempt,
                  geminiRequests: actualRequests,
                  error: message,
                }
              : row,
          ),
        );
        return {
          queueSignal: sawRateLimit ? "rate-limited" : "failed",
          audit: {
            id: item.id,
            name: item.name,
            reason,
            requests: actualRequests,
            retries: retryCount,
            cache: cacheState,
            status: "failed" as const,
            durationMs: Math.round(performance.now() - startedAt),
            error: message,
          },
        };
      } finally {
        updateRefinedProgress();
      }
    }
    return {
      queueSignal: sawRateLimit ? "rate-limited" : "failed",
      audit: {
        id: item.id,
        name: item.name,
        reason,
        requests: actualRequests,
        retries: retryCount,
        cache: cacheState,
        status: "failed" as const,
        durationMs: Math.round(performance.now() - startedAt),
        error: "Analysis retry limit reached",
      },
    };
  }

  function updateRefinedProgress() {
    const refinedDone = rowsRef.current.filter(
      (row) => row.geminiCandidate && (row.status === "analyzed" || row.status === "failed"),
    ).length;
    const totalRefined = Math.max(1, rowsRef.current.filter((row) => row.geminiCandidate).length);
    const p = Math.min(1, 0.5 + (refinedDone / totalRefined) * 0.5);
    setProgress(p);
  }

  function retryFailed() {
    const failed = rowsRef.current.filter((row) => row.status === "failed").map((row) => row.item);
    if (!failed.length) return;
    const runId = ++runIdRef.current;
    void analyzeRows(failed, runId, analysisConcurrency);
  }

  async function startSorting() {
    if (!canStartSorting || phase === "preparing") return;
    setPhase("preparing");
    const sortingStartedAt = performance.now();
    try {
      const processed = rowsRef.current
        .filter((row) => row.status !== "failed" && row.status !== "skipped" && row.photo?.analysis)
        .map((row) => ({
          photo: row.photo!,
          clipEmbeddingVector: row.clipEmbeddingVector,
        }));

      if (processed.length < 4) {
        setPhase("blocked");
        toast.error("At least 4 analyzed photos are needed to start sorting.");
        return;
      }

      const duplicateStartedAt = performance.now();
      const { photos: clusteredPhotos } = assignDuplicateClusters(processed);
      const duplicateDetectionMs = Math.round(performance.now() - duplicateStartedAt);
      const rankingStartedAt = performance.now();
      const { photos: rankedPhotos } = rankPhotos(clusteredPhotos, { settings: state.settings });
      const finalRankingMs = Math.round(performance.now() - rankingStartedAt);
      const groupingStartedAt = performance.now();
      const { photos: out, events, collections } = organizePhotos(rankedPhotos);
      const eventGroupingMs = Math.round(performance.now() - groupingStartedAt);
      await Promise.all([
        saveDuplicateClusterAssignments(out, imagePipelineVersion),
        savePhotoRankings(out, imagePipelineVersion),
      ]).catch((err) => {
        console.warn("[dumpdeck] metadata cache save failed", err);
      });

      const groups = buildDuplicateGroupsForPhotos(out);
      const hasGroups = groups.some((g) => g.photos.length > 1);

      console.debug("[dumpdeck] analysis debug", {
        selectedTags: state.settings.vibes,
        analysisRows: rowsRef.current.map((row) => ({
          id: row.item.id,
          name: row.item.name,
          status: row.status,
          error: row.error,
        })),
        duplicateGroups: groups.filter((group) => group.photos.length > 1),
        events,
        collections,
        scoreBreakdown: out.map((photo) => ({
          id: photo.id,
          name: photo.name,
          score: photo.ranking?.overallScore,
          breakdown: photo.ranking?.scoreBreakdown,
          duplicateClusterId: photo.duplicateClusterId,
        })),
      });
      console.debug("[perf] sorting preparation summary", {
        totalPhotosSelected: rowsRef.current.length,
        totalPhotosScannedLocally: processed.length,
        duplicateDetectionMs,
        finalRankingMs,
        eventGroupingMs,
        totalSortingPreparationMs: Math.round(performance.now() - sortingStartedAt),
        slowestStage: slowestStage({
          duplicateDetectionMs,
          finalRankingMs,
          eventGroupingMs,
        }),
      });
      console.debug(
        "[dumpdeck] duplicate groups",
        groups.filter((group) => group.photos.length > 1),
      );
      console.debug("[dumpdeck] same-event groups", events);

      dispatch({ type: "setPhotos", photos: out });

      if (hasGroups) {
        dispatch({ type: "setStage", stage: "similar" });
      } else {
        const sl = rankingShortlist(out, MAX_KEEP);
        const cutEntries: RemovedPhoto[] = removedByRanking(out, sl);
        if (cutEntries.length) dispatch({ type: "addRemoved", entries: cutEntries });
        if (cutEntries.length) {
          console.debug(
            "[dumpdeck] final removal reasons assigned",
            cutEntries.map((entry) => ({
              id: entry.photo.id,
              name: entry.photo.name,
              reason: entry.reason,
              source: entry.source,
            })),
          );
          console.debug("[dumpdeck] AI cut score components", {
            selectedTags: state.settings.vibes,
            cutPhotos: cutEntries.map((entry) => ({
              id: entry.photo.id,
              name: entry.photo.name,
              reason: entry.reason,
              rank: entry.photo.ranking?.overallRank,
              score: entry.photo.ranking?.overallScore,
              signals: entry.photo.ranking?.signals,
              breakdown: entry.photo.ranking?.scoreBreakdown,
            })),
          });
        }
        dispatch({ type: "setShortlist", photos: sl });
        dispatch({ type: "setStage", stage: "results" });
      }
    } catch (err) {
      console.error("[dumpdeck] sorting preparation failed", err);
      setPhase("ready");
      toast.error("Sorting could not start. Retry failed analysis or upload a fresh batch.");
    }
  }

  useEffect(() => {
    (async () => {
      const runId = ++runIdRef.current;
      const raw = sessionStorage.getItem("dumpdeck:pending");
      if (!raw) {
        dispatch({ type: "setStage", stage: "upload" });
        return;
      }
      let items: UploadItem[];
      try {
        items = JSON.parse(raw) as UploadItem[];
      } catch {
        sessionStorage.removeItem("dumpdeck:pending");
        toast.error("Upload session expired. Please choose your photos again.");
        dispatch({ type: "setStage", stage: "upload" });
        return;
      }
      if (!Array.isArray(items) || items.length === 0) {
        sessionStorage.removeItem("dumpdeck:pending");
        dispatch({ type: "setStage", stage: "upload" });
        return;
      }
      const config = await getPipelineConfig();
      if (runIdRef.current !== runId) return;
      setAnalysisConcurrency(config.analysisConcurrency);
      pendingItemsRef.current = items;
      setSample(items.slice(0, 9).map((i) => ({ url: i.url, previewUrl: i.previewUrl })));
      const initialRows: AnalysisRow[] = items.map((item) => ({
        item,
        status: "uploaded",
        attempts: 0,
        geminiRequests: 0,
      }));
      setRows(initialRows);
      rowsRef.current = initialRows;
      setProgress(0);
      setMaxGeminiPhotos(config.maxGeminiPhotos);
      const storageStartedAt = performance.now();
      void persistProjectUploads(activeProjectId(), items)
        .then((storedItems) => {
          storageUploadRef.current = {
            uploaded: storedItems.filter((item) => item.previewStoragePath || item.originalStoragePath)
              .length,
            durationMs: Math.round(performance.now() - storageStartedAt),
            failed: false,
          };
          mergeStoredUploads(storedItems);
          console.debug("[perf] background project storage upload complete", {
            projectId: activeProjectId(),
            totalPhotosSelected: items.length,
            totalPhotosUploadedToStorage: storageUploadRef.current.uploaded,
            storageUploadMs: storageUploadRef.current.durationMs,
          });
        })
        .catch((err) => {
          storageUploadRef.current = {
            uploaded: 0,
            durationMs: Math.round(performance.now() - storageStartedAt),
            failed: true,
          };
          console.warn("[dumpdeck] background project storage upload failed", err);
        });
      await analyzeRows(items, runId, config.analysisConcurrency);
    })();
    return () => {
      runIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="text-center">
      <Heading eyebrow="Step 2" title="Reading your camera roll" body={friendlyLine} />

      <div className="relative mx-auto mt-8 grid h-64 w-64 grid-cols-3 gap-1.5">
        {sample.map((p, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="overflow-hidden rounded-xl bg-muted"
          >
            <img
              src={p.previewUrl ?? p.url}
              alt=""
              decoding="async"
              className="h-full w-full object-cover"
            />
          </motion.div>
        ))}
        <motion.div
          aria-hidden
          animate={{ y: [0, 240, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none absolute inset-x-0 h-8 rounded-full bg-gradient-to-b from-transparent via-coral/60 to-transparent blur-sm"
        />
      </div>

      <div className="mx-auto mt-8 max-w-sm">
        <div className="h-2 overflow-hidden rounded-full bg-ink/10">
          <motion.div
            className={`h-full rounded-full ${canStartSorting ? "bg-mint" : "bg-coral"}`}
            animate={{ width: `${Math.round(mainProgress * 100)}%` }}
          />
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={progressLabel}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mx-auto mt-4 max-w-full px-2 text-center text-base font-semibold leading-snug text-ink sm:text-lg"
          >
            {progressLabel}
          </motion.div>
        </AnimatePresence>
        {rows.length > 0 && (
          <div className="mx-auto mt-2 max-w-xs space-y-1 text-center text-xs leading-relaxed text-muted-foreground">
            <p>{progressDetail}</p>
            {skippedRows.length > 0 && <p>{skippedReasonSummary}</p>}
            {accountedCount < rows.length && (
              <p>
                {rows.length - accountedCount} photo
                {rows.length - accountedCount === 1 ? "" : "s"} still being checked.
              </p>
            )}
          </div>
        )}
        {canStartSorting && backgroundRefiningCount > 0 && (
          <div className="mt-4 rounded-2xl bg-mint/20 px-4 py-3 text-left text-xs leading-relaxed text-ink">
            <div className="font-semibold">Your photos are ready to review.</div>
            <p className="mt-1 text-muted-foreground">
              You can start sorting now, or wait while FotoFairy finishes a deeper analysis that
              may improve your results.
            </p>
          </div>
        )}
      </div>

      {failedRows.length > 0 && (
        <div className="mx-auto mt-5 max-w-sm rounded-3xl bg-coral/10 p-3 text-left">
          <div className="text-sm font-semibold text-coral">
            {failedRows.length} photo{failedRows.length === 1 ? "" : "s"} couldn't be scanned
          </div>
          <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-ink/75">
            {failedRows.map((row) => (
              <li key={row.item.id} className="flex items-center gap-2">
                <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-muted">
                  <img
                    src={row.item.previewUrl ?? row.item.url}
                    alt=""
                    decoding="async"
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{row.item.name}</span>
                  <span className="line-clamp-1 text-muted-foreground">{row.error}</span>
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={retryFailed}
            disabled={hasActiveAnalysis || phase === "preparing"}
            className="mt-3 chip bg-white/80 text-ink disabled:opacity-60"
          >
            Try those photos again
          </button>
        </div>
      )}

      <div className="mx-auto mt-5 max-w-sm space-y-2">
        <Button
          onClick={startSorting}
          disabled={!canStartSorting || phase === "preparing"}
          className="h-14 w-full rounded-2xl bg-ink text-base font-semibold text-cream hover:bg-coral disabled:opacity-55"
        >
          {phase === "preparing"
            ? "Preparing your collection…"
            : canStartSorting
              ? failedRows.length
                ? `Start Sorting with ${usableCount} usable photos`
                : "Start Sorting"
              : hasActiveAnalysis
                ? "Start Sorting unlocks after quick scan"
                : "Not enough analyzed photos"}
        </Button>
        {failedRows.length > 0 && analyzedCount >= 4 && !hasActiveAnalysis && (
          <p className="text-xs text-muted-foreground">
            Failed photos will be skipped unless you retry them first.
          </p>
        )}
        <button
          type="button"
          onClick={() => dispatch({ type: "setStage", stage: "upload" })}
          disabled={hasActiveAnalysis || phase === "preparing"}
          className="chip disabled:opacity-60"
        >
          ← Back to upload
        </button>
      </div>
    </section>
  );
}

/* ───────────── Similar ───────────── */
function SimilarStage() {
  const { state, dispatch } = useDumpDeck();

  const allGroups = useMemo(() => buildDuplicateGroupsForPhotos(state.photos), [state.photos]);
  const similarGroups = useMemo(() => allGroups.filter((g) => g.photos.length > 1), [allGroups]);
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
    const decisions: DuplicateDecisionDraft[] = [];
    for (const g of similarGroups) {
      const selected = picked[g.id] ?? new Set<string>();
      const keptInGroup = g.photos.filter((p) => selected.has(p.id));
      const keptTop = keptInGroup[0] ?? g.photos[0];
      decisions.push({
        clusterId: keptTop.duplicateClusterId ?? `group-${g.id}`,
        keptPhotoIds: keptInGroup.map((photo) => photo.id),
        removedPhotoIds: g.photos
          .filter((photo) => !selected.has(photo.id))
          .map((photo) => photo.id),
        reason: g.reason,
      });
      for (const p of g.photos) {
        if (!selected.has(p.id)) {
          drops.push({
            photo: p,
            reason:
              selected.size === 0
                ? "User did not select from similar group."
                : `Removed from similar group — kept "${keptTop.name}" instead. ${g.reason}`,
            source: "user",
            similarToId: keptTop.id,
          });
        }
      }
    }
    if (drops.length) dispatch({ type: "addRemoved", entries: drops });
    dispatch({ type: "setDuplicateDecisions", decisions });

    const survivors = state.photos.filter((p) => keepIds.has(p.id));
    const { photos: rerankedSurvivors } = rankPhotos(survivors, { settings: state.settings });
    const { photos: organizedSurvivors } = organizePhotos(rerankedSurvivors);
    const allowMultipleClusterIds = new Set(
      decisions
        .filter((decision) => decision.keptPhotoIds.length > 1)
        .map((decision) => decision.clusterId),
    );
    const baseShortlist = rankingShortlist(organizedSurvivors, MAX_KEEP, {
      allowMultipleClusterIds,
    });
    const baseIds = new Set(baseShortlist.map((photo) => photo.id));
    const explicitKeeps = organizedSurvivors
      .filter((photo) => keepIds.has(photo.id) && !baseIds.has(photo.id))
      .sort((a, b) => rankingScore(b) - rankingScore(a));
    const sl = [...baseShortlist, ...explicitKeeps];
    const cuts: RemovedPhoto[] = removedByRanking(organizedSurvivors, sl);
    if (cuts.length) dispatch({ type: "addRemoved", entries: cuts });
    if (cuts.length) {
      console.debug(
        "[dumpdeck] final removal reasons assigned",
        cuts.map((entry) => ({
          id: entry.photo.id,
          name: entry.photo.name,
          reason: entry.reason,
          source: entry.source,
        })),
      );
      console.debug("[dumpdeck] AI cut score components", {
        selectedTags: state.settings.vibes,
        cutPhotos: cuts.map((entry) => ({
          id: entry.photo.id,
          name: entry.photo.name,
          reason: entry.reason,
          rank: entry.photo.ranking?.overallRank,
          score: entry.photo.ranking?.overallScore,
          signals: entry.photo.ranking?.signals,
          breakdown: entry.photo.ranking?.scoreBreakdown,
        })),
      });
    }

    dispatch({ type: "setShortlist", photos: sl });
    console.debug("[dumpdeck] duplicate decisions", {
      selectedTags: state.settings.vibes,
      decisions,
      kept: sl.map((photo) => photo.id),
      removed: [...drops, ...cuts].map((entry) => ({
        id: entry.photo.id,
        reason: entry.reason,
      })),
    });
    dispatch({ type: "setStage", stage: "results" });
  }

  const totalInGroups = similarGroups.reduce((a, g) => a + g.photos.length, 0);
  const totalPicked = Object.values(picked).reduce((a, s) => a + s.size, 0);
  const totalKept = totalPicked + singletonIds.size;

  return (
    <section>
      <Heading
        eyebrow="Step 3"
        title="Duplicate review"
        body={`We found ${similarGroups.length} conservative duplicate group${similarGroups.length === 1 ? "" : "s"}. Pick up to ${MAX_PICK} from each — unrelated photos stay out of this step.`}
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
                  Group {g.id + 1} · {g.kind === "exact" ? "Exact duplicates" : "Near-duplicates"}
                </span>
                <span className="text-[11px] font-semibold text-ink">
                  {sel.size} of {g.photos.length} selected
                </span>
              </div>
              <p className="mb-2 px-1 text-[11px] text-muted-foreground">
                {g.reason} Suggested best:{" "}
                {g.photos.find((photo) => photo.id === g.suggestedBestPhotoId)?.name ??
                  g.photos[0].name}
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
                        {Math.round(rankingScore(p) * 100)}
                      </div>
                      {isAiPick && (
                        <div className="absolute right-1 top-1 rounded-md bg-coral px-1 py-0.5 text-[9px] font-bold text-white shadow">
                          BEST
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
                  Keep best only
                </button>
                <button type="button" onClick={() => skipGroup(g.id)} className="chip">
                  Keep multiple
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

  function removeFromEventReview(photo: Photo) {
    dispatch({
      type: "addRemoved",
      entries: [
        {
          photo,
          reason: "removed by user during event review.",
          source: "user",
        },
      ],
    });
    dispatch({ type: "removePhoto", id: photo.id });
    toast("Removed from this collection");
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
        <ScoreBadge
          label="Top score"
          value={state.shortlist[0] ? rankingScore(state.shortlist[0]) : 0}
        />
        <ScoreBadge
          label="Kept"
          value={state.shortlist.length / Math.max(1, state.photos.length)}
        />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {state.shortlist.length} kept · {state.removed.length} removed
        </span>
        <button type="button" onClick={() => setShowRemoved(true)} className="chip">
          <Eye className="h-3 w-3" /> View removed ({state.removed.length})
        </button>
      </div>

      <OrganizationBrowser photos={state.shortlist} onRemovePhoto={removeFromEventReview} />

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

function OrganizationBrowser({
  photos,
  onRemovePhoto,
}: {
  photos: Photo[];
  onRemovePhoto: (photo: Photo) => void;
}) {
  const collections = useMemo(() => {
    const byCollection = new Map<
      string,
      {
        id: string;
        title: string;
        summary: string;
        cover?: Photo;
        events: Map<string, { id: string; title: string; description: string; photos: Photo[] }>;
        photos: Photo[];
      }
    >();

    photos.forEach((photo) => {
      const collection = photo.collectionGroup;
      const event = photo.eventGroup;
      const collectionId = collection?.groupId || "collection_unfiled";
      if (!byCollection.has(collectionId)) {
        byCollection.set(collectionId, {
          id: collectionId,
          title: collection?.title || "Camera Roll",
          summary: collection?.summary || "Photos that have not been grouped into a collection.",
          cover: photos.find((candidate) => candidate.id === collection?.coverPhoto) ?? photo,
          events: new Map(),
          photos: [],
        });
      }
      const collectionGroup = byCollection.get(collectionId)!;
      collectionGroup.photos.push(photo);

      const eventId = event?.groupId || `event_${photo.id}`;
      if (!collectionGroup.events.has(eventId)) {
        collectionGroup.events.set(eventId, {
          id: eventId,
          title: event?.title || "Ungrouped photo",
          description: event?.description || "Single photo from the camera roll.",
          photos: [],
        });
      }
      collectionGroup.events.get(eventId)!.photos.push(photo);
    });

    return Array.from(byCollection.values());
  }, [photos]);

  if (photos.length === 0) return null;

  return (
    <div className="mt-5 rounded-3xl border border-ink/10 bg-white/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Camera Roll → Collections → Events → Photos
          </div>
          <div className="font-display text-lg">AI organization</div>
        </div>
        <span className="chip bg-mint/40">{photos.length} photos</span>
      </div>

      <div className="mt-3 space-y-3">
        {collections.map((collection) => (
          <div key={collection.id} className="rounded-2xl bg-cream/80 p-2">
            <div className="flex gap-3">
              {collection.cover && (
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                  <img
                    src={collection.cover.previewUrl ?? collection.cover.url}
                    alt=""
                    decoding="async"
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-semibold">{collection.title}</div>
                  <span className="text-[11px] text-muted-foreground">
                    {collection.events.size} event{collection.events.size === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {collection.summary}
                </p>
              </div>
            </div>

            <div className="mt-2 space-y-2">
              {Array.from(collection.events.values()).map((event) => (
                <div key={event.id} className="rounded-xl bg-white/70 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{event.title}</div>
                      <div className="line-clamp-1 text-[11px] text-muted-foreground">
                        {event.description}
                      </div>
                    </div>
                    <span className="chip bg-ink/5 text-ink/70">{event.photos.length}</span>
                  </div>
                  <div className="mt-2 flex gap-1 overflow-x-auto pb-1 no-scrollbar">
                    {event.photos.map((photo) => (
                      <div
                        key={photo.id}
                        className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted"
                      >
                        <img
                          src={photo.previewUrl ?? photo.url}
                          alt=""
                          decoding="async"
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => onRemovePhoto(photo)}
                          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/65 text-white opacity-100 shadow transition sm:opacity-0 sm:group-hover:opacity-100"
                          aria-label={`Remove ${photo.name} from event`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
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

  const remove = useCallback(
    (id: string) => {
      setRemaining((cur) => {
        const idx = cur.findIndex((p) => p.id === id);
        if (idx === -1) return cur;
        const photo = cur[idx];
        dispatch({
          type: "addRemoved",
          entries: [{ photo, reason: "Removed by you during curate.", source: "user" }],
        });
        const next = cur.filter((p) => p.id !== id);
        setFocusIdx((fi) =>
          Math.min(Math.max(0, next.length - 1), idx === fi ? idx : fi > idx ? fi - 1 : fi),
        );
        return next;
      });
    },
    [dispatch],
  );

  const restore = useCallback(
    (id: string) => {
      const entry = state.removed.find((r) => r.photo.id === id);
      if (!entry) return;
      setRemaining((cur) => (cur.some((p) => p.id === id) ? cur : [...cur, entry.photo]));
      dispatch({ type: "restorePhoto", id });
      toast.success("Restored to your shortlist.");
    },
    [state.removed, dispatch],
  );

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
    dispatch({ type: "setKept", photos: remaining });
    dispatch({ type: "setFinalOrder", photos: orderWithPinned(remaining, state.pinnedCoverId) });
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
          <span className="chip inline-flex items-center gap-1 bg-mint/60 text-ink">
            <Check className="h-3 w-3" /> Under limit
          </span>
        )}
        <button type="button" onClick={() => setShowRemoved(true)} className="chip">
          <Eye className="h-3 w-3" /> Removed ({state.removed.length})
        </button>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div
          className={`h-full rounded-full transition-all ${overBy > 0 ? "bg-coral" : "bg-mint"}`}
          style={{
            width: `${Math.min(100, ((focusIdx + 1) / Math.max(1, remaining.length)) * 100)}%`,
          }}
        />
      </div>

      {focus ? (
        <div className="mt-5 relative">
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-between px-4">
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
                <img
                  src={focus.previewUrl ?? focus.url}
                  alt=""
                  decoding="async"
                  className="h-full w-full object-cover pointer-events-none"
                  draggable={false}
                />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute left-3 top-3 flex flex-wrap gap-1">
                {focus.tags.slice(0, 3).map((t) => (
                  <TagBadge key={t} tag={t} />
                ))}
              </div>
              <div className="absolute right-3 top-3 rounded-full bg-white/95 px-2 py-1 text-[11px] font-bold text-ink">
                {Math.round(rankingScore(focus) * 100)}
              </div>
              <div className="absolute inset-x-3 bottom-3 text-[11px] font-semibold uppercase tracking-wider text-white/90">
                {analysisOf(focus)?.scene ?? focus.photoType}
                {(analysisOf(focus)?.confidence ?? focus.photoTypeConfidence) < 0.55 &&
                  " (unsure)"}{" "}
                · {analysisOf(focus)?.peopleCount ?? focus.peopleCount} people ·{" "}
                {analysisOf(focus)?.orientation ?? focus.orientation}
              </div>
            </motion.div>
          </AnimatePresence>

          {reasoningFor(focus) && (
            <p className="mt-2 px-1 text-xs text-muted-foreground">{reasoningFor(focus)}</p>
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

      {remaining.length > 0 && (
        <MiniStrip remaining={remaining} focusIdx={focusIdx} onJump={setFocusIdx} />
      )}

      {canContinue ? (
        <StickyAction>
          <Button
            onClick={continueToFinal}
            className="h-14 w-full rounded-2xl bg-ink text-base font-semibold text-cream hover:bg-coral"
          >
            Next: Order my collection ({remaining.length}) →
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
              <button
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-full bg-ink/10"
              >
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
  if (r.source === "user" && r.reason) return r.reason;
  const cat = categorize(r);
  if (cat === "similar") return r.reason || "Too similar to another photo.";
  if (cat === "ai") {
    if (/^Keep:\s*/i.test(r.reason)) {
      const positiveSignal = r.reason.replace(/^Keep:\s*/i, "").replace(/\.$/, "").trim();
      return positiveSignal
        ? `Cut because stronger options ranked higher, even though this had ${positiveSignal.toLowerCase()}.`
        : "Cut because stronger options ranked higher.";
    }
    if (r.reason) return r.reason;
    const reasoning = analysisOf(r.photo)?.reasoning;
    if (reasoning && !/^Keep:/i.test(reasoning)) return reasoning;
    if (/shortlist/i.test(r.reason)) return "Lower quality / sharpness score.";
    return "Cut because this was lower-ranked than similar options.";
  }
  const reasoning = analysisOf(r.photo)?.reasoning;
  if (reasoning) return reasoning;
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
    { key: "ai", label: "Removed by AI", items: [] },
    { key: "user", label: "Removed by you", items: [] },
  ];
  for (const r of removed) {
    const cat = categorize(r);
    groups.find((g) => g.key === cat)!.items.push(r);
  }
  return (
    <div className="space-y-5">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
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
                        <span className="truncate text-xs text-muted-foreground">
                          {r.photo.name}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-ink/80">{friendlyReason(r)}</p>
                      {analysisOf(r.photo) && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Rank {analysisOf(r.photo)!.overallRank || "—"} · confidence{" "}
                          {Math.round(analysisOf(r.photo)!.confidence * 100)}%
                        </p>
                      )}
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
  const pinnedCover = state.finalOrder.find((photo) => photo.id === state.pinnedCoverId);

  function removeSlide(id: string) {
    const photo = state.finalOrder.find((p) => p.id === id);
    if (photo) {
      dispatch({
        type: "addRemoved",
        entries: [{ photo, reason: "Removed from final collection.", source: "user" }],
      });
    }
    if (state.pinnedCoverId === id) dispatch({ type: "setPinnedCover", id: null });
    dispatch({ type: "setFinalOrder", photos: state.finalOrder.filter((p) => p.id !== id) });
  }

  function pinCover(id: string) {
    const ordered = orderWithPinned(state.finalOrder, id);
    dispatch({ type: "setPinnedCover", id });
    dispatch({ type: "setFinalOrder", photos: ordered });
    toast.success("Cover pinned as slide 1.");
  }

  function unpinCover() {
    dispatch({ type: "setPinnedCover", id: null });
    toast("Cover pin removed.");
  }

  function runAiOrder() {
    setOrdering(true);
    setTimeout(() => {
      const ordered = aiOrder(state.finalOrder, state.settings, {
        pinnedCoverId: state.pinnedCoverId,
      });
      dispatch({ type: "setFinalOrder", photos: ordered });
      setOrdering(false);
      console.debug("[dumpdeck] final order", {
        selectedTags: state.settings.vibes,
        ordered: ordered.map((photo, index) => ({
          slide: index + 1,
          id: photo.id,
          scene: analysisOf(photo)?.scene ?? photo.photoType,
          event: photo.eventGroup?.title,
          collection: photo.collectionGroup?.title,
          people: analysisOf(photo)?.peopleCount ?? photo.peopleCount,
          orientation: analysisOf(photo)?.orientation ?? photo.orientation,
          score: rankingScore(photo),
        })),
      });
      toast.success("AI ordered your collection");
    }, 700);
  }

  return (
    <section>
      <Heading
        eyebrow="Step 6"
        title="Your final collection"
        body="Drag to reorder, or let AI build a balanced, dispersed flow."
      />

      <div className="mt-4 grid grid-cols-3 gap-2">
        <ScoreBadge
          label="Slides"
          value={state.finalOrder.length / 20}
          title="How full this carousel is relative to FotoFairy's 20-slide working limit."
        />
        <ScoreBadge
          label="Avg score"
          value={averagePhotoScore(state.finalOrder, rankingScore)}
          title="Average final ranking score from quality, aesthetic, duplicate, and preference signals."
        />
        <ScoreBadge
          label="Vibe match"
          value={averagePhotoScore(state.finalOrder, vibeAlignmentScore)}
          title="Average alignment with the selected vibe/tags. This is computed from ranking metadata, not a fixed score."
        />
      </div>

      <Button
        onClick={runAiOrder}
        disabled={ordering}
        className="mt-5 h-12 w-full rounded-2xl bg-coral text-base font-semibold text-white shadow-lg hover:bg-coral/90"
      >
        <Wand2 className="mr-2 h-4 w-4" />
        {ordering ? "Arranging the flow…" : "AI order my collection"}
      </Button>

      <div className="glass-card mt-5 rounded-3xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Cover photo
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pinnedCover
                ? "Pinned cover stays first while AI arranges the rest."
                : "Pick one slide to lock in as the cover."}
            </p>
          </div>
          {pinnedCover && (
            <button type="button" onClick={unpinCover} className="chip bg-white/80 text-ink">
              Unpin
            </button>
          )}
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {state.finalOrder.map((photo, index) => {
            const pinned = photo.id === state.pinnedCoverId;
            return (
              <button
                key={photo.id}
                type="button"
                onClick={() => (pinned ? unpinCover() : pinCover(photo.id))}
                className={`relative h-20 w-16 shrink-0 overflow-hidden rounded-2xl bg-muted transition ${
                  pinned ? "ring-4 ring-coral" : "ring-1 ring-ink/10"
                }`}
                aria-label={pinned ? `Unpin ${photo.name} as cover` : `Pin ${photo.name} as cover`}
              >
                <img
                  src={photo.previewUrl ?? photo.url}
                  alt=""
                  decoding="async"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <span className="absolute left-1 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-ink">
                  {index + 1}
                </span>
                {pinned && (
                  <span className="absolute inset-x-1 bottom-1 inline-flex items-center justify-center gap-1 rounded-full bg-coral px-1.5 py-0.5 text-[9px] font-bold text-white">
                    <Pin className="h-2.5 w-2.5" /> Cover
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <SortableGrid
          photos={state.finalOrder}
          onChange={(next) =>
            dispatch({
              type: "setFinalOrder",
              photos: orderWithPinned(next, state.pinnedCoverId),
            })
          }
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
  const { user } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);

  function removeSlide(id: string) {
    const photo = state.finalOrder.find((p) => p.id === id);
    if (photo) {
      dispatch({
        type: "addRemoved",
        entries: [{ photo, reason: "Removed from final collection.", source: "user" }],
      });
    }
    if (state.pinnedCoverId === id) dispatch({ type: "setPinnedCover", id: null });
    dispatch({ type: "setFinalOrder", photos: state.finalOrder.filter((p) => p.id !== id) });
    toast("Removed from collection");
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
      a.download = `fotofairy-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded! Time to post.");
    } catch {
      toast.error("Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveFinalDraft({
        draftId: activeDraftId(),
        projectId: activeProjectId(),
        allPhotos: state.photos,
        finalOrder: state.finalOrder,
        removed: state.removed,
        settings: state.settings,
        duplicateDecisions: state.duplicateDecisions,
        pinnedCoverPhotoId: state.pinnedCoverId,
      });
      console.debug("[dumpdeck] draft save response", {
        userId: user?.id,
        draftId: activeDraftId(),
        projectId: activeProjectId(),
        result,
        orderedPhotoIds: state.finalOrder.map((photo) => photo.id),
        rejectedPhotoIds: state.removed.map((entry) => entry.photo.id),
        duplicateDecisions: state.duplicateDecisions,
        pinnedCoverPhotoId: state.pinnedCoverId,
      });
      sessionStorage.setItem("dumpdeck:activeDraftId", result.id);
      toast.success(
        result.storage === "supabase" ? "Collection saved" : "Saved locally only for this browser.",
      );
    } catch (err) {
      console.error("[dumpdeck] draft save failed", err);
      toast.error("Couldn't save draft.");
    } finally {
      setSaving(false);
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
            <div
              className="relative overflow-hidden rounded-3xl bg-muted shadow-xl"
              style={{ aspectRatio: aspect }}
            >
              <img
                src={p.previewUrl ?? p.url}
                alt=""
                decoding="async"
                loading="lazy"
                className="h-full w-full object-cover"
              />
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
            disabled={saving || state.finalOrder.length === 0}
            className="h-12 rounded-2xl border-ink/15 bg-white/70 font-semibold"
          >
            <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save collection"}
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
        Collections save to Supabase when signed in. Local-only saves are only used in dev mode.
      </p>
      <DebugPanel />
    </section>
  );
}

function DebugPanel() {
  const { state } = useDumpDeck();

  if (!import.meta.env.DEV) return null;

  const duplicateGroups = buildDuplicateGroupsForPhotos(state.photos).filter(
    (group) => group.photos.length > 1,
  );
  const events = Array.from(
    new Map(
      state.photos
        .map((photo) => photo.eventGroup)
        .filter((event): event is NonNullable<Photo["eventGroup"]> => Boolean(event))
        .map((event) => [event.groupId, event]),
    ).values(),
  );
  const collections = Array.from(
    new Map(
      state.photos
        .map((photo) => photo.collectionGroup)
        .filter((collection): collection is NonNullable<Photo["collectionGroup"]> =>
          Boolean(collection),
        )
        .map((collection) => [collection.groupId, collection]),
    ).values(),
  );

  return (
    <details className="mt-5 rounded-2xl border border-ink/10 bg-white/70 p-3 text-left text-xs">
      <summary className="cursor-pointer font-semibold">Debug analysis</summary>
      <div className="mt-3 space-y-3">
        <div>
          <div className="font-semibold">Selected tags</div>
          <div className="text-muted-foreground">{state.settings.vibes.join(", ")}</div>
        </div>
        <div>
          <div className="font-semibold">Duplicate groups</div>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {duplicateGroups.map((group) => (
              <li key={group.id}>
                {group.reason} · {group.photos.map((photo) => photo.name).join(" / ")}
              </li>
            ))}
            {duplicateGroups.length === 0 && <li>None</li>}
          </ul>
        </div>
        <div>
          <div className="font-semibold">Events</div>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {events.map((event) => (
              <li key={event.groupId}>
                {event.title}: {event.photoCount} photo{event.photoCount === 1 ? "" : "s"} ·{" "}
                {event.description}
              </li>
            ))}
            {events.length === 0 && <li>None</li>}
          </ul>
        </div>
        <div>
          <div className="font-semibold">Collections</div>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {collections.map((collection) => (
              <li key={collection.groupId}>
                {collection.title}: {collection.eventCount} event
                {collection.eventCount === 1 ? "" : "s"} · {collection.photoCount} photo
                {collection.photoCount === 1 ? "" : "s"}
              </li>
            ))}
            {collections.length === 0 && <li>None</li>}
          </ul>
        </div>
        <div>
          <div className="font-semibold">Score breakdown</div>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {state.photos.map((photo) => (
              <li key={photo.id}>
                {photo.name}: {Math.round(rankingScore(photo) * 100)} · tag boost{" "}
                {Math.round((photo.ranking?.scoreBreakdown?.tagBoost ?? 0) * 100)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-semibold">Final selected</div>
          <div className="text-muted-foreground">
            {state.finalOrder.map((photo) => photo.name).join(", ") || "None yet"}
          </div>
        </div>
        <div>
          <div className="font-semibold">Rejected</div>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {state.removed.map((entry) => (
              <li key={entry.photo.id}>
                {entry.photo.name}: {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

/* ───────────── Caption Ideas ───────────── */
function CaptionIdeas() {
  const { state } = useDumpDeck();
  const [seed, setSeed] = useState(0);
  const ideas = useMemo<CaptionIdea[]>(
    () => generateCaptions(state.finalOrder, state.settings.vibes, seed),
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
            Generated from your vibes and the tags in your final collection. Tap to copy.
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
      <button type="button" onClick={() => setOpen((v) => !v)} className="chip">
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
