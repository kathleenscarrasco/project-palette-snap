import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Copy,
  FolderOpen,
  Home,
  ImageIcon,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { isLocalDevAuth, supabase, type SavedProject } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { BrandMark, BrandWordmark } from "@/components/dumpdeck/brand";
import {
  duplicateFinalDraft,
  listFinalDrafts,
  savedDraftDebugSummary,
  type SavedFinalDraft,
} from "@/lib/dumpdeck/drafts";
import { deleteStoredProjectPhotos, listProjectPhotoSummaries } from "@/lib/dumpdeck/storage";

export const Route = createFileRoute("/projects")({
  head: () => ({ meta: [{ title: "Your saved collections · FotoFairy" }] }),
  errorComponent: ProjectsError,
  component: ProjectsRouteShell,
});

const LOCAL_PROJECTS_KEY = "dumpdeck:dev-projects";

type ProjectStatus = {
  uploadedCount: number;
  selectedCount: number;
  countLabel: string;
  hasFinalOrder: boolean;
  updatedAt: string | null;
  draftId: string | null;
  latestDraft: SavedFinalDraft | null;
  coverUrl: string | null;
};

type ProjectPhotoSummary = {
  projectId: string;
  count: number;
  firstPhotoUrl: string | null;
};

function loadLocalProjects(): SavedProject[] {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
    if (raw) return JSON.parse(raw) as SavedProject[];
  } catch {
    // Fall through to the default seed. This storage is local-dev only.
  }
  const seeded = [
    {
      id: "local-demo-project",
      user_id: "local-dev-user",
      title: "Demo FotoFairy Collection",
      description: "Local-only test collection for upload and sorting flow QA.",
      created_at: new Date().toISOString(),
    },
  ];
  saveLocalProjects(seeded);
  return seeded;
}

function saveLocalProjects(projects: SavedProject[]) {
  localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(projects));
}

function projectPersistenceErrorMessage(err: unknown, fallback = "Could not save collection") {
  const message = err instanceof Error ? err.message : String(err || fallback);
  if (
    /saved_projects|schema cache|relation .* does not exist|table .* does not exist/i.test(message)
  ) {
    return "Collection storage is not set up yet. Apply the Supabase persistence migration, then try again.";
  }
  return message || fallback;
}

function statusForProject(
  project: SavedProject,
  drafts: SavedFinalDraft[],
  photoSummary?: ProjectPhotoSummary,
): ProjectStatus {
  const projectDrafts = drafts
    .filter((draft) => draft.projectId === project.id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const latest = projectDrafts[0];
  const uploadedCount = latest
    ? new Set([...latest.orderedPhotoIds, ...latest.rejectedPhotoIds]).size
    : (photoSummary?.count ?? 0);
  const selectedCount = latest?.orderedPhotoIds.length ?? 0;
  const hasFinalOrder = selectedCount > 0;
  return {
    uploadedCount,
    selectedCount,
    countLabel: hasFinalOrder
      ? `${selectedCount} photo${selectedCount === 1 ? "" : "s"}`
      : uploadedCount
        ? `${uploadedCount} uploaded · no final cut yet`
        : "No saved photos yet",
    hasFinalOrder,
    updatedAt: latest?.updatedAt ?? project.updated_at ?? project.created_at,
    draftId: latest?.id ?? null,
    latestDraft: latest ?? null,
    coverUrl: latest ? coverUrlForDraft(latest) : (photoSummary?.firstPhotoUrl ?? null),
  };
}

function coverUrlForDraft(draft: SavedFinalDraft): string | null {
  const payload = draft.draftPayload;
  const finalOrder = payload?.finalOrder ?? [];
  const uploaded = payload?.uploadedPhotos ?? [];
  const pinnedId = draft.selectedPreferences?.pinnedCoverPhotoId ?? payload?.pinnedCoverPhotoId;
  const cover =
    (pinnedId ? finalOrder.find((photo) => photo.id === pinnedId) : null) ??
    finalOrder[0] ??
    uploaded[0];
  return cover?.previewUrl ?? cover?.previewFileUrl ?? cover?.url ?? null;
}

function openDraftPayload(navigate: ReturnType<typeof useNavigate>, draft: SavedFinalDraft) {
  console.debug("[dumpdeck] saved projects open draft requested", {
    action: "continue_project",
    routeChosen: "/app",
    ...savedDraftDebugSummary(draft),
  });
  if (!draft.draftPayload?.finalOrder?.length) {
    console.warn("[dumpdeck] saved project draft cannot open", savedDraftDebugSummary(draft));
    toast.error(
      "This draft is missing its final photo order. Open the collection and save it again.",
    );
    return;
  }
  sessionStorage.setItem("dumpdeck:activeProjectId", draft.projectId ?? "");
  sessionStorage.setItem("dumpdeck:activeDraftId", draft.id);
  try {
    sessionStorage.setItem("dumpdeck:resumeDraft", JSON.stringify(draft.draftPayload));
  } catch (err) {
    console.warn("[dumpdeck] could not stage draft payload for app fallback", {
      error: err,
      ...savedDraftDebugSummary(draft),
    });
    sessionStorage.removeItem("dumpdeck:resumeDraft");
  }
  sessionStorage.setItem("dumpdeck:resumeDraftStage", "export");
  void navigate({ to: "/app" });
}

async function createProjectRecord(userId: string, title = "Untitled FotoFairy Collection") {
  const now = new Date().toISOString();
  if (isLocalDevAuth) {
    const saved: SavedProject = {
      id: `local-${crypto.randomUUID()}`,
      user_id: userId,
      title,
      description: null,
      created_at: now,
      updated_at: now,
    };
    saveLocalProjects([saved, ...loadLocalProjects()]);
    return saved;
  }

  const { data, error } = await supabase
    .from("saved_projects")
    .insert({ user_id: userId, title, description: null })
    .select("id, user_id, title, description, created_at, updated_at")
    .single();
  if (error) throw error;
  return data as SavedProject;
}

function ProjectsError({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-5 text-center">
      <div className="max-w-sm">
        <h1 className="font-display text-3xl">Collections did not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We could not open your saved collections. Try again or sign back in.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="chip bg-ink text-cream">
            Try again
          </button>
          <Link to="/auth" className="chip">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}

function ProjectsRouteShell() {
  const location = useLocation();
  return location.pathname === "/projects" ? <ProjectsPage /> : <Outlet />;
}

function ProjectsPage() {
  const navigate = useNavigate();
  const { user, isAuthed, loading: authLoading, signOut } = useAuth();
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [drafts, setDrafts] = useState<SavedFinalDraft[]>([]);
  const [photoSummaries, setPhotoSummaries] = useState<Map<string, ProjectPhotoSummary>>(new Map());
  const [view, setView] = useState<"home" | "saved">("home");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedProject | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedProject | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [autoCreatingFirstProject, setAutoCreatingFirstProject] = useState(false);
  const [duplicatingProjectId, setDuplicatingProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthed) navigate({ to: "/auth" });
  }, [authLoading, isAuthed, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    if (isLocalDevAuth) {
      const localProjects = loadLocalProjects();
      setProjects(localProjects);
      setDrafts(await listFinalDrafts());
      setPhotoSummaries(new Map());
      setError(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("saved_projects")
      .select("id, user_id, title, description, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false, nullsFirst: false });
    if (error) {
      console.error("[saved_projects] load error:", error);
      setError(error.message);
      setDrafts([]);
    } else {
      console.log("[saved_projects] loaded", data?.length ?? 0);
      setProjects((data ?? []) as SavedProject[]);
      setDrafts(await listFinalDrafts());
      setPhotoSummaries(await listProjectPhotoSummaries());
      setError(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  function openProject(id: string) {
    sessionStorage.setItem("dumpdeck:activeProjectId", id);
    sessionStorage.removeItem("dumpdeck:activeDraftId");
    sessionStorage.removeItem("dumpdeck:resumeDraft");
    sessionStorage.removeItem("dumpdeck:resumeDraftStage");
    void navigate({ to: "/projects/$projectId", params: { projectId: id } });
  }

  function continueProject(project: SavedProject) {
    const status = statusForProject(project, drafts, photoSummaries.get(project.id));
    console.debug("[dumpdeck] continue project requested", {
      project_id: project.id,
      user_id: user?.id,
      routeChosen: status.latestDraft?.draftPayload?.finalOrder?.length
        ? "/app:final-draft"
        : "/projects/$projectId",
      saved_photo_count: photoSummaries.get(project.id)?.count ?? 0,
      final_selected_photo_count: status.latestDraft?.draftPayload?.finalOrder?.length ?? 0,
      final_order_photo_ids:
        status.latestDraft?.draftPayload?.orderedPhotoIds ??
        status.latestDraft?.orderedPhotoIds ??
        [],
      pinned_cover_photo_id:
        status.latestDraft?.draftPayload?.pinnedCoverPhotoId ??
        status.latestDraft?.selectedPreferences?.pinnedCoverPhotoId ??
        null,
      draft_id: status.latestDraft?.id ?? null,
      missing_data: status.latestDraft ? savedDraftDebugSummary(status.latestDraft).missing : [],
    });
    if (status.latestDraft?.draftPayload?.finalOrder?.length) {
      openDraftPayload(navigate, status.latestDraft);
      return;
    }
    openProject(project.id);
  }

  async function startNewProject() {
    if (!user || creatingProject) return;
    setCreatingProject(true);
    setError(null);
    try {
      const project = await createProjectRecord(user.id);
      sessionStorage.setItem("dumpdeck:activeProjectId", project.id);
      sessionStorage.removeItem("dumpdeck:activeDraftId");
      sessionStorage.removeItem("dumpdeck:resumeDraft");
      sessionStorage.removeItem("dumpdeck:resumeDraftStage");
      toast.success("Collection created");
      void navigate({ to: "/app" });
    } catch (err) {
      const msg = projectPersistenceErrorMessage(err, "Could not create collection");
      console.error("[saved_projects] create project failed:", err);
      setError(msg);
      toast.error(msg);
    } finally {
      setCreatingProject(false);
    }
  }

  useEffect(() => {
    if (!user || loading || error || projects.length > 0 || autoCreatingFirstProject) return;
    setAutoCreatingFirstProject(true);
    void (async () => {
      try {
        const project = await createProjectRecord(user.id, "My first FotoFairy Collection");
        sessionStorage.setItem("dumpdeck:activeProjectId", project.id);
        sessionStorage.removeItem("dumpdeck:activeDraftId");
        sessionStorage.removeItem("dumpdeck:resumeDraft");
        sessionStorage.removeItem("dumpdeck:resumeDraftStage");
        toast.success("Collection created. Add your first photos.");
        void navigate({ to: "/app", replace: true });
      } catch (err) {
        const msg = projectPersistenceErrorMessage(err, "Could not create your first collection");
        console.error("[saved_projects] auto-create first project failed:", err);
        setError(msg);
        toast.error(msg);
      } finally {
        setAutoCreatingFirstProject(false);
      }
    })();
  }, [autoCreatingFirstProject, error, loading, navigate, projects.length, user]);

  async function duplicateProject(project: SavedProject) {
    if (duplicatingProjectId) return;
    setDuplicatingProjectId(project.id);
    try {
      const status = statusForProject(project, drafts);
      if (status.draftId) {
        const result = await duplicateFinalDraft(status.draftId, project.title);
        toast.success("Collection duplicated");
        await load();
        sessionStorage.setItem("dumpdeck:activeProjectId", result.projectId);
        sessionStorage.setItem("dumpdeck:activeDraftId", result.draftId);
        sessionStorage.removeItem("dumpdeck:resumeDraft");
        sessionStorage.setItem("dumpdeck:resumeDraftStage", "export");
        console.debug("[dumpdeck] duplicated project draft route chosen", {
          action: "duplicate_project",
          user_id: user?.id,
          source_project_id: project.id,
          project_id: result.projectId,
          draft_id: result.draftId,
          routeChosen: "/app",
        });
        void navigate({ to: "/app" });
        return;
      }
      const copy = await createProjectRecord(user!.id, `${project.title} copy`);
      if (project.description) {
        if (isLocalDevAuth) {
          saveLocalProjects(
            loadLocalProjects().map((item) =>
              item.id === copy.id ? { ...item, description: project.description } : item,
            ),
          );
        } else {
          await supabase
            .from("saved_projects")
            .update({ description: project.description })
            .eq("id", copy.id)
            .eq("user_id", user!.id);
        }
      }
      toast.success("Collection duplicated");
      await load();
      openProject(copy.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not duplicate collection";
      console.error("[saved_projects] duplicate failed:", err);
      toast.error(msg);
    } finally {
      setDuplicatingProjectId(null);
    }
  }

  async function remove(id: string) {
    const previousProjects = projects;
    const previousDrafts = drafts;
    const previousPhotoSummaries = photoSummaries;

    setProjects((current) => current.filter((project) => project.id !== id));
    setDrafts((current) => current.filter((draft) => draft.projectId !== id));
    setPhotoSummaries((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    toast.success("Collection deleted");

    try {
      if (isLocalDevAuth) {
        saveLocalProjects(loadLocalProjects().filter((project) => project.id !== id));
        return;
      }
      await deleteStoredProjectPhotos(id);
      const { error } = await supabase.from("saved_projects").delete().eq("id", id);
      if (error) throw error;
    } catch (err) {
      setProjects(previousProjects);
      setDrafts(previousDrafts);
      setPhotoSummaries(previousPhotoSummaries);
      const message = err instanceof Error ? err.message : "Could not delete collection";
      toast.error(message);
      console.error("[saved_projects] delete failed:", err);
    }
  }

  if (authLoading || !isAuthed) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 pb-16 pt-8">
      <div className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-coral/30 blur-3xl animate-blob" />
      <div
        className="pointer-events-none absolute -right-16 top-60 h-80 w-80 rounded-full bg-lavender/40 blur-3xl animate-blob"
        style={{ animationDelay: "-5s" }}
      />

      <div className="mx-auto w-full max-w-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/projects" className="flex items-center gap-2">
            <BrandMark className="h-9 w-9" />
            <BrandWordmark size="text-xl" />
          </Link>
          <div className="flex items-center gap-2">
            <span className="chip max-w-[180px] truncate" title={user?.email ?? ""}>
              {user?.email}
            </span>
            <button
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth" });
              }}
              className="chip hover:bg-coral hover:text-white"
            >
              <LogOut className="h-3 w-3" /> Sign out
            </button>
          </div>
        </header>

        <section className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-4xl tracking-tight">
                {view === "home" ? "Keep the memories. Lose the clutter." : "Saved collections"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {view === "home"
                  ? "Turn hundreds of photos into the ones you'll actually keep."
                  : "Open, edit, duplicate, or delete your saved FotoFairy collections."}
              </p>
            </div>
            {view === "saved" && (
              <button
                onClick={startNewProject}
                disabled={creatingProject}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 font-semibold text-cream transition hover:bg-coral disabled:opacity-60"
              >
                {creatingProject ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                New collection
              </button>
            )}
          </div>
        </section>

        {error && (
          <div className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {autoCreatingFirstProject && (
          <div className="mt-6 flex items-center gap-2 rounded-2xl bg-white/70 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Creating your first collection…
          </div>
        )}

        {view === "home" && !autoCreatingFirstProject && (
          <section className="mt-8 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={startNewProject}
              disabled={creatingProject}
              className="glass-card rounded-3xl p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-coral/15 text-coral">
                {creatingProject ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Plus className="h-5 w-5" />
                )}
              </span>
              <div className="mt-5 font-display text-3xl">New collection</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Upload your photos and let the magic begin.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setView("saved")}
              className="glass-card rounded-3xl p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-mint/60 text-ink">
                <FolderOpen className="h-5 w-5" />
              </span>
              <div className="mt-5 font-display text-3xl">Saved collections</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Continue one of your {projects.length} saved collection
                {projects.length === 1 ? "" : "s"}.
              </p>
            </button>
          </section>
        )}

        {view === "saved" && (
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => setView("home")} className="chip">
              <Home className="h-3 w-3" /> Back to home
            </button>
          </div>
        )}

        {view === "saved" && (
          <section className="mt-6 space-y-3">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}

            {!loading && projects.length === 0 && (
              <div className="glass-card rounded-2xl p-8 text-center">
                <div className="font-display text-2xl">No saved collections yet</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Create your first FotoFairy collection, then upload photos and start sorting.
                </p>
                <button
                  onClick={startNewProject}
                  disabled={creatingProject}
                  className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 font-semibold text-cream hover:bg-coral"
                >
                  {creatingProject ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create your first collection
                </button>
              </div>
            )}

            {!loading &&
              projects.map((p) => (
                <article
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => continueProject(p)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      continueProject(p);
                    }
                  }}
                  className="glass-card flex cursor-pointer items-start gap-3 rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-coral"
                >
                  {(() => {
                    const status = statusForProject(p, drafts, photoSummaries.get(p.id));
                    return (
                      <>
                        <div className="h-24 w-32 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-coral/15 via-mint/20 to-lavender/25">
                          {status.coverUrl ? (
                            <img
                              src={status.coverUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center text-ink/35">
                              <ImageIcon className="h-7 w-7" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">{p.title}</div>
                          {p.description && (
                            <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                              {p.description}
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="chip bg-ink text-cream">Open collection</span>
                            <span className="chip bg-mint/40">{status.countLabel}</span>
                            <span className="chip bg-white/80">
                              {status.hasFinalOrder ? "Final order saved" : "No final order yet"}
                            </span>
                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              Updated {new Date(status.updatedAt ?? p.created_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void duplicateProject(p);
                          }}
                          disabled={duplicatingProjectId === p.id}
                          className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink/5 disabled:opacity-60"
                          aria-label="Duplicate"
                        >
                          {duplicatingProjectId === p.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditing(p);
                            setShowForm(true);
                          }}
                          className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink/5"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDelete(p);
                          }}
                          className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    );
                  })()}
                </article>
              ))}
          </section>
        )}
      </div>

      {showForm && user && (
        <ProjectForm
          userId={user.id}
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={async (project) => {
            const shouldOpen = !editing && !!project;
            setShowForm(false);
            await load();
            if (shouldOpen) openProject(project.id);
          }}
        />
      )}

      {pendingDelete && (
        <DeleteProjectDialog
          project={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            const project = pendingDelete;
            setPendingDelete(null);
            await remove(project.id);
          }}
        />
      )}
    </main>
  );
}

function DeleteProjectDialog({
  project,
  onClose,
  onConfirm,
}: {
  project: SavedProject;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
      >
        <h2 id="delete-project-title" className="font-display text-2xl">
          Delete collection?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This removes "{project.title}" from your saved collections.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-11 flex-1 rounded-xl border border-ink/10 font-semibold hover:bg-ink/5 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-destructive font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectForm({
  userId,
  initial,
  onClose,
  onSaved,
}: {
  userId: string;
  initial: SavedProject | null;
  onClose: () => void;
  onSaved: (project?: SavedProject) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (initial) {
        if (isLocalDevAuth) {
          const saved = {
            ...initial,
            title: title.trim(),
            description: description.trim() || null,
          };
          saveLocalProjects(
            loadLocalProjects().map((project) => (project.id === initial.id ? saved : project)),
          );
          toast.success("Saved");
          await onSaved(saved);
          return;
        }
        const { data, error } = await supabase
          .from("saved_projects")
          .update({ title: title.trim(), description: description.trim() || null })
          .eq("id", initial.id)
          .select("id, user_id, title, description, created_at, updated_at")
          .single();
        if (error) throw error;
        toast.success("Saved");
        await onSaved(data as SavedProject);
      } else {
        if (isLocalDevAuth) {
          const saved: SavedProject = {
            id: `local-${crypto.randomUUID()}`,
            user_id: userId,
            title: title.trim(),
            description: description.trim() || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          saveLocalProjects([saved, ...loadLocalProjects()]);
          toast.success("Created");
          await onSaved(saved);
          return;
        }
        const { data, error } = await supabase
          .from("saved_projects")
          .insert({ user_id: userId, title: title.trim(), description: description.trim() || null })
          .select("id, user_id, title, description, created_at, updated_at")
          .single();
        if (error) throw error;
        toast.success("Created");
        await onSaved(data as SavedProject);
      }
    } catch (err) {
      const msg = projectPersistenceErrorMessage(err, "Save failed");
      console.error("[saved_projects] save error:", err);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl">
            {initial ? "Edit collection" : "New collection"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg hover:bg-ink/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <input
            required
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            className="h-12 w-full rounded-xl border border-ink/10 bg-white px-4 text-base outline-none focus:border-coral disabled:opacity-60"
          />
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={4}
            className="w-full rounded-xl border border-ink/10 bg-white px-4 py-3 text-base outline-none focus:border-coral disabled:opacity-60"
          />
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-ink/10 font-semibold hover:bg-ink/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink font-semibold text-cream hover:bg-coral disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {initial ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
