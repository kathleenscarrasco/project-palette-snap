import { isLocalDevAuth, supabase } from "@/integrations/supabase/client";
import type { Photo, RemovedPhoto, Settings } from "./types";

const DRAFTS_TABLE = "dumpdeck_drafts";
const LOCAL_DRAFTS_KEY = "dumpdeck:local-drafts";

export type DuplicateDecisionDraft = {
  clusterId: string;
  keptPhotoIds: string[];
  removedPhotoIds: string[];
  reason: string;
};

export type SaveDraftInput = {
  draftId?: string | null;
  projectId?: string | null;
  allPhotos?: Photo[];
  finalOrder: Photo[];
  removed: RemovedPhoto[];
  settings: Settings;
  duplicateDecisions: DuplicateDecisionDraft[];
  pinnedCoverPhotoId?: string | null;
  saveAsNew?: boolean;
};

export type SaveDraftResult = {
  id: string;
  storage: "supabase" | "local";
  updatedAt: string;
};

export type FinalDraftPayload = ReturnType<typeof buildDraftPayload>;

export type SavedFinalDraft = {
  id: string;
  projectId: string | null;
  orderedPhotoIds: string[];
  rejectedPhotoIds: string[];
  duplicateDecisions: DuplicateDecisionDraft[];
  selectedPreferences: Settings & { pinnedCoverPhotoId?: string | null };
  scoresReasons: unknown[];
  draftPayload: FinalDraftPayload | null;
  createdAt: string;
  updatedAt: string;
  storage: "supabase" | "local";
};

export async function saveFinalDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  const payload = buildDraftPayload(input);
  if (isLocalDevAuth) return saveLocalDraft(payload);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw userError ?? new Error("Sign in before saving this project.");
  }
  if (!asUuid(input.projectId)) {
    throw new Error("Choose or create a project before saving.");
  }

  const row = {
    user_id: userData.user.id,
    project_id: asUuid(input.projectId),
    ordered_photo_ids: input.finalOrder.map((photo) => photo.id),
    rejected_photo_ids: input.removed.map((entry) => entry.photo.id),
    duplicate_decisions: input.duplicateDecisions,
    selected_preferences: {
      ...input.settings,
      pinnedCoverPhotoId: input.pinnedCoverPhotoId ?? null,
    },
    scores_reasons: payload.scoresReasons,
    draft_payload: payload,
    updated_at: payload.updatedAt,
  };

  if (input.draftId && !input.saveAsNew) {
    const { data, error } = await supabase
      .from(DRAFTS_TABLE)
      .update(row)
      .eq("id", input.draftId)
      .eq("user_id", userData.user.id)
      .select("id,updated_at")
      .single();

    if (error) {
      console.warn("[dumpdeck] Supabase draft update failed", error);
      throw error;
    }
    await touchProject(input.projectId, userData.user.id, payload.updatedAt);

    return {
      id: String((data as { id: string }).id),
      storage: "supabase",
      updatedAt: String((data as { updated_at: string }).updated_at),
    };
  }

  if (input.saveAsNew) {
    const { data, error } = await supabase
      .from(DRAFTS_TABLE)
      .insert(row)
      .select("id,updated_at")
      .single();

    if (error) {
      console.warn("[dumpdeck] Supabase draft insert failed", error);
      throw error;
    }
    await touchProject(input.projectId, userData.user.id, payload.updatedAt);

    return {
      id: String((data as { id: string }).id),
      storage: "supabase",
      updatedAt: String((data as { updated_at: string }).updated_at),
    };
  }

  const { data, error } = await supabase
    .from(DRAFTS_TABLE)
    .upsert(row, { onConflict: "user_id,project_id" })
    .select("id,updated_at")
    .single();

  if (error) {
    console.warn("[dumpdeck] Supabase draft save failed", error);
    throw error;
  }
  await touchProject(input.projectId, userData.user.id, payload.updatedAt);

  return {
    id: String((data as { id: string }).id),
    storage: "supabase",
    updatedAt: String((data as { updated_at: string }).updated_at),
  };
}

async function touchProject(
  projectId: string | null | undefined,
  userId: string,
  updatedAt: string,
) {
  const id = asUuid(projectId);
  if (!id) return;
  const { error } = await supabase
    .from("saved_projects")
    .update({ updated_at: updatedAt })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) console.warn("[dumpdeck] project timestamp update failed", error);
}

export async function listFinalDrafts(projectId?: string | null): Promise<SavedFinalDraft[]> {
  if (isLocalDevAuth) return listLocalDrafts(projectId);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return listLocalDrafts(projectId);

  let query = supabase
    .from(DRAFTS_TABLE)
    .select(
      "id,project_id,ordered_photo_ids,rejected_photo_ids,duplicate_decisions,selected_preferences,scores_reasons,draft_payload,created_at,updated_at",
    )
    .eq("user_id", userData.user.id)
    .order("updated_at", { ascending: false });

  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;
  if (error) {
    console.warn("[dumpdeck] Supabase draft list failed; falling back to local drafts", error);
    return listLocalDrafts(projectId);
  }
  return ((data ?? []) as DraftRow[]).map(normalizeDraftRow);
}

export async function duplicateFinalDraft(
  draftId: string,
  projectTitle: string,
): Promise<{ projectId: string; draftId: string; storage: "supabase" | "local" }> {
  if (isLocalDevAuth) return duplicateLocalDraft(draftId, projectTitle);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return duplicateLocalDraft(draftId, projectTitle);

  const { data: draft, error: draftError } = await supabase
    .from(DRAFTS_TABLE)
    .select(
      "id,project_id,ordered_photo_ids,rejected_photo_ids,duplicate_decisions,selected_preferences,scores_reasons,draft_payload",
    )
    .eq("id", draftId)
    .eq("user_id", userData.user.id)
    .single();
  if (draftError || !draft) throw draftError ?? new Error("Draft not found");

  const now = new Date().toISOString();
  const { data: project, error: projectError } = await supabase
    .from("saved_projects")
    .insert({
      user_id: userData.user.id,
      title: `${projectTitle} copy`,
      description: "Duplicated from an existing DumpDeck draft.",
    })
    .select("id")
    .single();
  if (projectError || !project) throw projectError ?? new Error("Could not duplicate project");

  const projectId = String((project as { id: string }).id);
  const source = draft as DraftRow;
  const draftPayload = {
    ...(source.draft_payload ?? {}),
    projectId,
    createdAt: now,
    updatedAt: now,
  };
  const { data: copied, error: copyError } = await supabase
    .from(DRAFTS_TABLE)
    .insert({
      user_id: userData.user.id,
      project_id: projectId,
      ordered_photo_ids: source.ordered_photo_ids ?? [],
      rejected_photo_ids: source.rejected_photo_ids ?? [],
      duplicate_decisions: source.duplicate_decisions ?? [],
      selected_preferences: source.selected_preferences ?? {},
      scores_reasons: source.scores_reasons ?? [],
      draft_payload: draftPayload,
      updated_at: now,
    })
    .select("id")
    .single();
  if (copyError || !copied) throw copyError ?? new Error("Could not duplicate draft");

  return {
    projectId,
    draftId: String((copied as { id: string }).id),
    storage: "supabase",
  };
}

function buildDraftPayload(input: SaveDraftInput) {
  const now = new Date().toISOString();
  return {
    projectId: input.projectId ?? null,
    draftId: input.draftId ?? null,
    uploadedPhotos: input.allPhotos ?? input.finalOrder,
    finalOrder: input.finalOrder,
    removed: input.removed,
    restoredPhotoIds: input.finalOrder.map((photo) => photo.id),
    orderedPhotoIds: input.finalOrder.map((photo) => photo.id),
    pinnedCoverPhotoId: input.pinnedCoverPhotoId ?? null,
    rejectedPhotoIds: input.removed.map((entry) => entry.photo.id),
    duplicateDecisions: input.duplicateDecisions,
    selectedPreferences: input.settings,
    scoresReasons: [
      ...(input.allPhotos ?? input.finalOrder),
      ...input.removed.map((entry) => entry.photo),
    ].map((photo) => ({
      id: photo.id,
      name: photo.name,
      score: photo.ranking?.overallScore ?? photo.overall,
      ranking: photo.ranking,
      tags: photo.tags,
      reasons: photo.reasons,
      duplicateClusterId: photo.duplicateClusterId ?? null,
      sourceMetadata: photo.sourceMetadata,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

function saveLocalDraft(payload: FinalDraftPayload): SaveDraftResult {
  const id = payload.draftId ?? payload.projectId ?? `local-draft-${Date.now()}`;
  const drafts = loadLocalDrafts();
  drafts[id] = { ...payload, id };
  localStorage.setItem(LOCAL_DRAFTS_KEY, JSON.stringify(drafts));
  return {
    id,
    storage: "local",
    updatedAt: payload.updatedAt,
  };
}

function loadLocalDrafts() {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type DraftRow = {
  id: string;
  project_id: string | null;
  ordered_photo_ids: string[] | null;
  rejected_photo_ids: string[] | null;
  duplicate_decisions: DuplicateDecisionDraft[] | null;
  selected_preferences: (Settings & { pinnedCoverPhotoId?: string | null }) | null;
  scores_reasons: unknown[] | null;
  draft_payload: FinalDraftPayload | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function normalizeDraftRow(row: DraftRow): SavedFinalDraft {
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    orderedPhotoIds: row.ordered_photo_ids ?? [],
    rejectedPhotoIds: row.rejected_photo_ids ?? [],
    duplicateDecisions: row.duplicate_decisions ?? [],
    selectedPreferences: row.selected_preferences ?? { formats: ["portrait"], vibes: ["random"] },
    scoresReasons: row.scores_reasons ?? [],
    draftPayload: row.draft_payload ?? null,
    createdAt: row.created_at ?? row.updated_at ?? new Date(0).toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date(0).toISOString(),
    storage: "supabase",
  };
}

function listLocalDrafts(projectId?: string | null): SavedFinalDraft[] {
  return Object.entries(loadLocalDrafts())
    .map(([id, value]) => normalizeLocalDraft(id, value))
    .filter((draft): draft is SavedFinalDraft => Boolean(draft))
    .filter((draft) => !projectId || draft.projectId === projectId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function normalizeLocalDraft(id: string, value: unknown): SavedFinalDraft | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as FinalDraftPayload & { id?: string };
  return {
    id: payload.id ?? id,
    projectId: payload.projectId ?? null,
    orderedPhotoIds: payload.orderedPhotoIds ?? [],
    rejectedPhotoIds: payload.rejectedPhotoIds ?? [],
    duplicateDecisions: payload.duplicateDecisions ?? [],
    selectedPreferences: {
      ...(payload.selectedPreferences ?? { formats: ["portrait"], vibes: ["random"] }),
      pinnedCoverPhotoId: payload.pinnedCoverPhotoId ?? null,
    },
    scoresReasons: payload.scoresReasons ?? [],
    draftPayload: payload,
    createdAt: payload.createdAt ?? new Date(0).toISOString(),
    updatedAt: payload.updatedAt ?? payload.createdAt ?? new Date(0).toISOString(),
    storage: "local",
  };
}

function duplicateLocalDraft(
  draftId: string,
  projectTitle: string,
): { projectId: string; draftId: string; storage: "local" } {
  const drafts = loadLocalDrafts();
  const source = drafts[draftId];
  if (!source || typeof source !== "object") throw new Error("Draft not found");
  const now = new Date().toISOString();
  const projectId = `local-project-${Date.now()}`;
  const nextDraftId = projectId;
  const payload = {
    ...(source as FinalDraftPayload),
    id: nextDraftId,
    projectId,
    draftId: nextDraftId,
    createdAt: now,
    updatedAt: now,
  };
  drafts[nextDraftId] = payload;
  localStorage.setItem(LOCAL_DRAFTS_KEY, JSON.stringify(drafts));

  const projectsRaw = localStorage.getItem("dumpdeck:dev-projects");
  const projects = projectsRaw ? (JSON.parse(projectsRaw) as unknown[]) : [];
  projects.unshift({
    id: projectId,
    user_id: "local-dev-user",
    title: `${projectTitle} copy`,
    description: "Duplicated from an existing DumpDeck draft.",
    created_at: now,
  });
  localStorage.setItem("dumpdeck:dev-projects", JSON.stringify(projects));
  return { projectId, draftId: nextDraftId, storage: "local" };
}

function asUuid(value: string | null | undefined) {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}
