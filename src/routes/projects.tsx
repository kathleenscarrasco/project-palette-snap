import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import {
  Check,
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
    console.error("[saved_projects] production persistence setup error:", err);
    return "We couldn’t save your collection right now. Please try again in a moment.";
  }
  return message || "We couldn’t save your collection right now. Please try again in a moment.";
}

function activeProjectId() {
  try {
    return sessionStorage.getItem("dumpdeck:activeProjectId");
  } catch {
    return null;
  }
}

function nextCopyTitle(title: string, existingTitles: Iterable<string>) {
  const cleanTitle = title.trim() || "Untitled FotoFairy Collection";
  const names = new Set(Array.from(existingTitles).map((name) => name.trim().toLowerCase()));
  const base = `${cleanTitle} (Copy)`;
  if (!names.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${cleanTitle} (Copy ${index})`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true']"));
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [bulkAction, setBulkAction] = useState<{
    type: "copying" | "deleting";
    completed: number;
    total: number;
  } | null>(null);

  const selectedProjects = useMemo(
    () => projects.filter((project) => selectedIds.has(project.id)),
    [projects, selectedIds],
  );
  const allSelected = projects.length > 0 && selectedIds.size === projects.length;
  const bulkBusy = Boolean(bulkAction);

  useEffect(() => {
    if (!authLoading && !isAuthed) navigate({ to: "/auth" });
  }, [authLoading, isAuthed, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    const startedAt = performance.now();
    setLoading(true);
    if (isLocalDevAuth) {
      const localProjects = loadLocalProjects();
      setProjects(localProjects);
      setPhotoSummaries(new Map());
      setError(null);
      setLoading(false);
      void listFinalDrafts().then(setDrafts).catch(console.warn);
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
      const loadedProjects = (data ?? []) as SavedProject[];
      console.log("[saved_projects] loaded", loadedProjects.length, {
        projectRowsMs: Math.round(performance.now() - startedAt),
      });
      setProjects(loadedProjects);
      setError(null);
      setLoading(false);

      void (async () => {
        const detailStartedAt = performance.now();
        try {
          const [nextDrafts, nextPhotoSummaries] = await Promise.all([
            listFinalDrafts(),
            listProjectPhotoSummaries(),
          ]);
          setDrafts(nextDrafts);
          setPhotoSummaries(nextPhotoSummaries);
          console.debug("[perf] saved collection details hydrated", {
            projects: loadedProjects.length,
            drafts: nextDrafts.length,
            photoSummaryProjects: nextPhotoSummaries.size,
            detailsMs: Math.round(performance.now() - detailStartedAt),
          });
        } catch (detailError) {
          console.warn("[saved_projects] background detail load failed:", detailError);
        }
      })();
      return;
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    setSelectedIds((current) => {
      const projectIds = new Set(projects.map((project) => project.id));
      const next = new Set(Array.from(current).filter((id) => projectIds.has(id)));
      if (next.size === current.size) return current;
      if (next.size === 0) {
        setSelectionMode(false);
        setLastSelectedIndex(null);
      }
      return next;
    });
  }, [projects]);

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

  function cancelSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
  }

  function selectAllProjects() {
    setSelectionMode(true);
    setSelectedIds(new Set(projects.map((project) => project.id)));
    setLastSelectedIndex(projects.length ? projects.length - 1 : null);
  }

  function toggleProjectSelection(
    project: SavedProject,
    index: number,
    event?: MouseEvent<HTMLElement>,
  ) {
    setSelectionMode(true);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (event?.shiftKey && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        projects.slice(start, end + 1).forEach((rangeProject) => next.add(rangeProject.id));
      } else if (next.has(project.id)) {
        next.delete(project.id);
      } else {
        next.add(project.id);
      }
      return next;
    });
    setLastSelectedIndex(index);
  }

  useEffect(() => {
    if (view !== "saved" || !selectionMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancelSelection();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (allSelected) {
          setSelectedIds(new Set());
        } else {
          setSelectionMode(true);
          setSelectedIds(new Set(projects.map((project) => project.id)));
          setLastSelectedIndex(projects.length ? projects.length - 1 : null);
        }
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedIds.size > 0) {
          event.preventDefault();
          setPendingBulkDelete(true);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [allSelected, selectedIds.size, selectionMode, view, projects]);

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

  async function renameProject(projectId: string, title: string, description?: string | null) {
    if (isLocalDevAuth) {
      saveLocalProjects(
        loadLocalProjects().map((project) =>
          project.id === projectId
            ? { ...project, title, description: description ?? project.description }
            : project,
        ),
      );
      return;
    }
    const update: { title: string; description?: string | null } = { title };
    if (description !== undefined) update.description = description;
    const { error } = await supabase
      .from("saved_projects")
      .update(update)
      .eq("id", projectId)
      .eq("user_id", user!.id);
    if (error) throw error;
  }

  async function duplicateProject(
    project: SavedProject,
    options: { openAfter?: boolean; title?: string; silent?: boolean; reload?: boolean } = {},
  ) {
    if (duplicatingProjectId) return;
    setDuplicatingProjectId(project.id);
    try {
      const status = statusForProject(project, drafts);
      const copyTitle = options.title ?? `${project.title} copy`;
      if (status.draftId) {
        const result = await duplicateFinalDraft(status.draftId, project.title);
        if (options.title) await renameProject(result.projectId, options.title);
        if (!options.silent) toast.success("Collection duplicated");
        if (options.reload !== false) await load();
        if (options.openAfter === false) return result;
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
        return result;
      }
      const copy = await createProjectRecord(user!.id, copyTitle);
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
      if (!options.silent) toast.success("Collection duplicated");
      if (options.reload !== false) await load();
      if (options.openAfter === false) return { projectId: copy.id, draftId: null };
      openProject(copy.id);
      return { projectId: copy.id, draftId: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not duplicate collection";
      console.error("[saved_projects] duplicate failed:", err);
      if (options.silent) throw err;
      toast.error(msg);
    } finally {
      setDuplicatingProjectId(null);
    }
  }

  async function deleteProjectPersistence(id: string) {
    if (isLocalDevAuth) {
      saveLocalProjects(loadLocalProjects().filter((project) => project.id !== id));
      return;
    }
    await deleteStoredProjectPhotos(id);
    const { error } = await supabase.from("saved_projects").delete().eq("id", id);
    if (error) throw error;
  }

  async function remove(id: string, options: { silent?: boolean } = {}) {
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
    if (!options.silent) toast.success("Collection deleted");

    try {
      await deleteProjectPersistence(id);
      if (activeProjectId() === id) {
        sessionStorage.removeItem("dumpdeck:activeProjectId");
        sessionStorage.removeItem("dumpdeck:activeDraftId");
        sessionStorage.removeItem("dumpdeck:resumeDraft");
        sessionStorage.removeItem("dumpdeck:resumeDraftStage");
      }
    } catch (err) {
      setProjects(previousProjects);
      setDrafts(previousDrafts);
      setPhotoSummaries(previousPhotoSummaries);
      const message = err instanceof Error ? err.message : "Could not delete collection";
      if (!options.silent) toast.error(message);
      console.error("[saved_projects] delete failed:", err);
      if (options.silent) throw err;
    }
  }

  async function bulkCopySelected() {
    if (!selectedProjects.length || bulkBusy) return;
    const targets = [...selectedProjects];
    setBulkAction({ type: "copying", completed: 0, total: targets.length });
    const existingTitles = new Set(projects.map((project) => project.title));
    const copiedIds: string[] = [];
    try {
      for (const project of targets) {
        const title = nextCopyTitle(project.title, existingTitles);
        existingTitles.add(title);
        const result = await duplicateProject(project, {
          openAfter: false,
          title,
          silent: true,
          reload: false,
        });
        if (result?.projectId) copiedIds.push(result.projectId);
        setBulkAction((current) =>
          current ? { ...current, completed: current.completed + 1 } : current,
        );
      }
      toast.success(`${targets.length} collection${targets.length === 1 ? "" : "s"} copied.`);
      cancelSelection();
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not copy selected collections";
      toast.error(message);
      console.error("[saved_projects] bulk copy failed:", {
        error: err,
        selectedIds: targets.map((project) => project.id),
        copiedIds,
      });
      await load();
    } finally {
      setBulkAction(null);
      setDuplicatingProjectId(null);
    }
  }

  async function bulkDeleteSelected() {
    if (!selectedProjects.length || bulkBusy) return;
    const targets = [...selectedProjects];
    const targetIds = new Set(targets.map((project) => project.id));
    const previousProjects = projects;
    const previousDrafts = drafts;
    const previousPhotoSummaries = photoSummaries;

    setPendingBulkDelete(false);
    setBulkAction({ type: "deleting", completed: 0, total: targets.length });
    setProjects((current) => current.filter((project) => !targetIds.has(project.id)));
    setDrafts((current) =>
      current.filter((draft) => !draft.projectId || !targetIds.has(draft.projectId)),
    );
    setPhotoSummaries((current) => {
      const next = new Map(current);
      targetIds.forEach((id) => next.delete(id));
      return next;
    });

    try {
      for (const project of targets) {
        await deleteProjectPersistence(project.id);
        setBulkAction((current) =>
          current ? { ...current, completed: current.completed + 1 } : current,
        );
      }
      if (activeProjectId() && targetIds.has(activeProjectId()!)) {
        sessionStorage.removeItem("dumpdeck:activeProjectId");
        sessionStorage.removeItem("dumpdeck:activeDraftId");
        sessionStorage.removeItem("dumpdeck:resumeDraft");
        sessionStorage.removeItem("dumpdeck:resumeDraftStage");
      }
      toast.success(`${targets.length} collection${targets.length === 1 ? "" : "s"} deleted.`);
      cancelSelection();
    } catch (err) {
      setProjects(previousProjects);
      setDrafts(previousDrafts);
      setPhotoSummaries(previousPhotoSummaries);
      const message = err instanceof Error ? err.message : "Could not delete selected collections";
      toast.error(message);
      console.error("[saved_projects] bulk delete failed:", {
        error: err,
        selectedIds: targets.map((project) => project.id),
      });
    } finally {
      setBulkAction(null);
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
                {view === "home"
                  ? "Keep the memories. Lose the clutter."
                  : selectionMode
                    ? `${selectedIds.size} Collection${selectedIds.size === 1 ? "" : "s"} Selected`
                    : "Saved collections"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {view === "home"
                  ? "Turn hundreds of photos into the ones you'll actually keep."
                  : selectionMode
                    ? "Choose collections to copy or delete."
                    : "Open, edit, duplicate, or delete your saved FotoFairy collections."}
              </p>
            </div>
            {view === "saved" && (
              <div className="flex flex-wrap justify-end gap-2">
                {selectionMode ? (
                  <>
                    <button
                      type="button"
                      onClick={allSelected ? () => setSelectedIds(new Set()) : selectAllProjects}
                      disabled={bulkBusy || projects.length === 0}
                      className="chip bg-white/80 text-ink disabled:opacity-60"
                    >
                      {allSelected ? "Deselect all" : "Select all"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelSelection}
                      disabled={bulkBusy}
                      className="chip disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectionMode(true)}
                      disabled={projects.length === 0}
                      className="chip bg-white/80 text-ink disabled:opacity-60"
                    >
                      Select
                    </button>
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
                  </>
                )}
              </div>
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
              projects.map((p, index) => (
                <article
                  key={p.id}
                  role={selectionMode ? "checkbox" : "button"}
                  aria-checked={selectionMode ? selectedIds.has(p.id) : undefined}
                  tabIndex={0}
                  onClick={(event) => {
                    if (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
                      toggleProjectSelection(p, index, event);
                      return;
                    }
                    continueProject(p);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (selectionMode) toggleProjectSelection(p, index);
                      else continueProject(p);
                    }
                  }}
                  className={`glass-card relative flex cursor-pointer items-start gap-3 rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-coral ${
                    selectedIds.has(p.id)
                      ? "bg-mint/20 ring-2 ring-coral"
                      : selectionMode
                        ? "ring-1 ring-ink/10"
                        : ""
                  }`}
                >
                  {(() => {
                    const status = statusForProject(p, drafts, photoSummaries.get(p.id));
                    const selected = selectedIds.has(p.id);
                    return (
                      <>
                        {selectionMode && (
                          <span
                            className={`absolute left-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full border-2 shadow-sm transition ${
                              selected
                                ? "border-coral bg-coral text-white"
                                : "border-white bg-white/90 text-transparent"
                            }`}
                            aria-hidden
                          >
                            <Check className="h-4 w-4" />
                          </span>
                        )}
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
                        {!selectionMode && (
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
                        )}
                        {!selectionMode && (
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
                        )}
                        {!selectionMode && (
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
                        )}
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

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          bulkAction={bulkAction}
          onCopy={bulkCopySelected}
          onDelete={() => setPendingBulkDelete(true)}
          onCancel={cancelSelection}
        />
      )}

      {pendingBulkDelete && (
        <BulkDeleteDialog
          count={selectedProjects.length}
          includesActiveProject={selectedIds.has(activeProjectId() ?? "")}
          busy={bulkAction?.type === "deleting"}
          onClose={() => setPendingBulkDelete(false)}
          onConfirm={bulkDeleteSelected}
        />
      )}
    </main>
  );
}

function BulkActionBar({
  selectedCount,
  bulkAction,
  onCopy,
  onDelete,
  onCancel,
}: {
  selectedCount: number;
  bulkAction: { type: "copying" | "deleting"; completed: number; total: number } | null;
  onCopy: () => void | Promise<void>;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const busy = Boolean(bulkAction);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl rounded-3xl bg-ink p-3 text-cream shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold">
              {busy
                ? `${bulkAction!.type === "copying" ? "Copying" : "Deleting"}…`
                : `${selectedCount} selected`}
            </div>
            {busy && (
              <div className="mt-0.5 text-xs text-cream/65">
                {bulkAction!.completed} of {bulkAction!.total}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              disabled={selectedCount === 0 || busy}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-3 text-sm font-bold text-ink disabled:opacity-45"
            >
              <Copy className="h-4 w-4" />
              Copy
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={selectedCount === 0 || busy}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-coral px-3 text-sm font-bold text-white disabled:opacity-45"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="h-11 rounded-2xl bg-white/10 px-3 text-sm font-bold text-cream disabled:opacity-45"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BulkDeleteDialog({
  count,
  includesActiveProject,
  busy,
  onClose,
  onConfirm,
}: {
  count: number;
  includesActiveProject: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
      >
        <h2 id="bulk-delete-title" className="font-display text-2xl">
          Delete {count} collection{count === 1 ? "" : "s"}?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This will permanently delete the selected collection{count === 1 ? "" : "s"}.
        </p>
        {includesActiveProject && (
          <p className="mt-3 rounded-2xl bg-coral/10 px-3 py-2 text-xs font-semibold text-coral">
            One selected collection is currently active in this browser. Deleting it may close your
            in-progress workspace.
          </p>
        )}
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
            onClick={onConfirm}
            disabled={busy || count === 0}
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
