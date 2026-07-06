import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Copy, FileText, Loader2, Play, Upload, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { isLocalDevAuth, supabase, type SavedProject } from "@/integrations/supabase/client";
import { duplicateFinalDraft, listFinalDrafts, type SavedFinalDraft } from "@/lib/dumpdeck/drafts";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project workspace · dumpify" }] }),
  errorComponent: ProjectWorkspaceError,
  component: ProjectWorkspacePage,
});

const LOCAL_PROJECTS_KEY = "dumpdeck:dev-projects";

function loadLocalProject(projectId: string): SavedProject | null {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
    const projects = raw ? (JSON.parse(raw) as SavedProject[]) : [];
    return projects.find((project) => project.id === projectId) ?? null;
  } catch {
    return null;
  }
}

function ProjectWorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-5 text-center">
      <div className="max-w-sm">
        <h1 className="font-display text-3xl">Project did not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The project workspace hit a temporary issue.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="chip bg-ink text-cream">
            Try again
          </button>
          <Link to="/projects" className="chip">
            Back to projects
          </Link>
        </div>
      </div>
    </main>
  );
}

function ProjectWorkspacePage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const { user, isAuthed, loading: authLoading } = useAuth();
  const [project, setProject] = useState<SavedProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [refinementRunning, setRefinementRunning] = useState(false);
  const [drafts, setDrafts] = useState<SavedFinalDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [duplicatingDraftId, setDuplicatingDraftId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthed) void navigate({ to: "/auth", replace: true });
  }, [authLoading, isAuthed, navigate]);

  const loadProject = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    if (isLocalDevAuth) {
      if (projectId === "local-demo-project" && !loadLocalProject(projectId)) {
        setProject({
          id: "local-demo-project",
          user_id: "local-dev-user",
          title: "Demo DumpDeck Project",
          description: "Local-only test project for upload and sorting flow QA.",
          created_at: new Date().toISOString(),
        });
      } else {
        setProject(loadLocalProject(projectId));
      }
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("saved_projects")
      .select("id, user_id, title, description, created_at")
      .eq("user_id", user.id)
      .eq("id", projectId)
      .maybeSingle();

    if (error) {
      setError(error.message);
      setProject(null);
    } else {
      setProject((data as SavedProject | null) ?? null);
    }
    setLoading(false);
  }, [projectId, user]);

  useEffect(() => {
    if (user) void loadProject();
  }, [loadProject, user]);

  const loadDrafts = useCallback(async () => {
    if (!user) return;
    setDraftsLoading(true);
    try {
      setDrafts(await listFinalDrafts(projectId));
    } catch (err) {
      console.warn("[dumpdeck] draft list failed", err);
      setDrafts([]);
    } finally {
      setDraftsLoading(false);
    }
  }, [projectId, user]);

  useEffect(() => {
    if (user) void loadDrafts();
  }, [loadDrafts, user]);

  useEffect(() => {
    try {
      const key = `dumpdeck:project:${projectId}:uploadCount`;
      const count = Number(sessionStorage.getItem(key) ?? localStorage.getItem(key) ?? 0);
      const pending = sessionStorage.getItem("dumpdeck:pending");
      setUploadedCount(Number.isFinite(count) ? Math.max(0, count) : 0);
      setRefinementRunning(Boolean(pending));
    } catch {
      setUploadedCount(0);
      setRefinementRunning(false);
    }
  }, [projectId]);

  function openUploadFlow() {
    sessionStorage.setItem("dumpdeck:activeProjectId", projectId);
    void navigate({ to: "/app" });
  }

  function startSorting() {
    if (uploadedCount <= 0) return;
    sessionStorage.setItem("dumpdeck:activeProjectId", projectId);
    void navigate({ to: "/app" });
  }

  function openDraft(draft: SavedFinalDraft) {
    if (!draft.draftPayload?.finalOrder?.length) {
      toast.error("This older draft is missing photo details. Save a new draft to reopen it here.");
      return;
    }
    sessionStorage.setItem("dumpdeck:activeProjectId", draft.projectId ?? projectId);
    sessionStorage.setItem("dumpdeck:activeDraftId", draft.id);
    sessionStorage.setItem("dumpdeck:resumeDraft", JSON.stringify(draft.draftPayload));
    void navigate({ to: "/app" });
  }

  async function duplicateDraft(draft: SavedFinalDraft) {
    if (duplicatingDraftId) return;
    setDuplicatingDraftId(draft.id);
    try {
      const result = await duplicateFinalDraft(draft.id, project?.title ?? "DumpDeck draft");
      toast.success("Draft duplicated");
      void navigate({ to: "/projects/$projectId", params: { projectId: result.projectId } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not duplicate draft";
      console.error("[dumpdeck] draft duplicate failed", err);
      toast.error(message);
    } finally {
      setDuplicatingDraftId(null);
    }
  }

  const statusCopy =
    uploadedCount > 0
      ? `${uploadedCount} photo${uploadedCount === 1 ? "" : "s"} uploaded · ${
          refinementRunning ? "refinement still running" : "ready to sort"
        }`
      : "No photos uploaded yet · upload a batch first";

  if (authLoading || loading) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading project…
        </span>
      </main>
    );
  }

  if (error || !project) {
    return (
      <main className="grid min-h-screen place-items-center px-5 text-center">
        <div className="max-w-sm">
          <BrandMark className="mx-auto h-12 w-12" />
          <h1 className="mt-4 font-display text-3xl">Project not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error ?? "This project may have been deleted or belongs to another account."}
          </p>
          <Link
            to="/projects"
            className="mt-5 inline-flex h-11 items-center rounded-xl bg-ink px-4 font-semibold text-cream"
          >
            Back to saved projects
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 pb-16 pt-8">
      <div className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-coral/30 blur-3xl animate-blob" />
      <div className="pointer-events-none absolute -right-16 top-60 h-80 w-80 rounded-full bg-lavender/40 blur-3xl animate-blob" />

      <div className="mx-auto w-full max-w-2xl">
        <header className="flex items-center justify-between gap-3">
          <Link to="/projects" className="flex items-center gap-2">
            <BrandMark className="h-9 w-9" />
            <BrandWordmark size="text-xl" />
          </Link>
          <Link to="/projects" className="chip">
            <ArrowLeft className="h-3 w-3" /> Projects
          </Link>
        </header>

        <section className="mt-10">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Project workspace
          </div>
          <h1 className="mt-1 font-display text-4xl tracking-tight">{project.title}</h1>
          {project.description && (
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">{project.description}</p>
          )}
          <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">
            Created {new Date(project.created_at).toLocaleString()}
          </p>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={openUploadFlow}
            className="glass-card rounded-2xl p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-coral/15 text-coral">
              <Upload className="h-5 w-5" />
            </span>
            <div className="mt-4 font-display text-2xl">Upload photos</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Add or replace photos for this project.
            </p>
          </button>

          <button
            type="button"
            onClick={startSorting}
            disabled={uploadedCount <= 0}
            className="glass-card rounded-2xl p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-mint/60 text-ink">
              <Wand2 className="h-5 w-5" />
            </span>
            <div className="mt-4 font-display text-2xl">Start sorting</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Continue with the current uploaded and analyzed batch.
            </p>
            <p className="mt-3 text-xs font-semibold text-ink/70">{statusCopy}</p>
          </button>
        </section>

        <div className="mt-8">
          <Button
            onClick={startSorting}
            disabled={uploadedCount <= 0}
            className="h-14 w-full rounded-2xl bg-ink text-base font-semibold text-cream hover:bg-coral disabled:opacity-55"
          >
            <Play className="mr-2 h-4 w-4" />{" "}
            {uploadedCount > 0 ? "Start Sorting" : "Upload photos first"}
          </Button>
          {uploadedCount <= 0 && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Use Upload photos to add a batch before starting the curation flow.
            </p>
          )}
        </div>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Saved drafts
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Reopen, edit, or duplicate a saved final cut.
              </p>
            </div>
            {draftsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {!draftsLoading && drafts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/15 bg-white/55 p-5 text-sm text-muted-foreground">
              No saved drafts yet. Finish a sort and tap Save draft to store one here.
            </div>
          ) : (
            <div className="space-y-2">
              {drafts.map((draft) => (
                <div key={draft.id} className="glass-card rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => openDraft(draft)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <FileText className="h-4 w-4 text-coral" />
                        Draft from {new Date(draft.updatedAt).toLocaleString()}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {draft.orderedPhotoIds.length} selected · {draft.rejectedPhotoIds.length}{" "}
                        removed
                        {draft.selectedPreferences?.pinnedCoverPhotoId ? " · cover pinned" : ""}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicateDraft(draft)}
                      disabled={duplicatingDraftId === draft.id}
                      className="chip bg-white/80 text-ink disabled:opacity-60"
                    >
                      {duplicatingDraftId === draft.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      Duplicate
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => openDraft(draft)}
                    className="mt-3 h-10 w-full rounded-xl bg-ink text-sm font-semibold text-cream transition hover:bg-coral"
                  >
                    Open draft
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
