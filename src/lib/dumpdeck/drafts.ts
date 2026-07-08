import { isLocalDevAuth, supabase } from "@/integrations/supabase/client";
import { generateCaptions } from "./captions";
import { copyStoredProjectPhotosForDraft, hydrateStoredDrafts } from "./storage";
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

export function draftHasDisplayablePhotos(draft: SavedFinalDraft) {
  return Boolean(
    draft.draftPayload?.finalOrder?.some((photo) => {
      const url = photo.previewUrl ?? photo.previewFileUrl ?? photo.url;
      return Boolean(url && !url.startsWith("blob:"));
    }),
  );
}

export async function saveFinalDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  const payload = await makeDraftPayloadDurable(buildDraftPayload(input));
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
    await updateProjectSummary(input.projectId, userData.user.id, payload, String(data.id));

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
    await updateProjectSummary(input.projectId, userData.user.id, payload, String(data.id));

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
  await updateProjectSummary(input.projectId, userData.user.id, payload, String(data.id));

  return {
    id: String((data as { id: string }).id),
    storage: "supabase",
    updatedAt: String((data as { updated_at: string }).updated_at),
  };
}

async function updateProjectSummary(
  projectId: string | null | undefined,
  userId: string,
  payload: FinalDraftPayload,
  draftId: string,
) {
  const id = asUuid(projectId);
  if (!id) return;
  const { error } = await supabase
    .from("saved_projects")
    .update({
      selected_preferences: {
        ...payload.selectedPreferences,
        pinnedCoverPhotoId: payload.pinnedCoverPhotoId ?? null,
      },
      duplicate_decisions: payload.duplicateDecisions,
      final_order_photo_ids: payload.orderedPhotoIds,
      removed_photo_ids: payload.rejectedPhotoIds,
      restored_photo_ids: payload.restoredPhotoIds,
      pinned_cover_photo_id: payload.pinnedCoverPhotoId ?? null,
      caption_ideas: payload.captionIdeas,
      active_draft_id: draftId,
      updated_at: payload.updatedAt,
    })
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
  return hydrateStoredDrafts(((data ?? []) as DraftRow[]).map(normalizeDraftRow));
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
  const sourcePhotoIds = Array.from(
    new Set([...(source.ordered_photo_ids ?? []), ...(source.rejected_photo_ids ?? [])]),
  );
  await copyStoredProjectPhotosForDraft(source.project_id, projectId, sourcePhotoIds);
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
  await updateProjectSummary(
    projectId,
    userData.user.id,
    draftPayload as FinalDraftPayload,
    String(copied.id),
  );

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
    captionIdeas: generateCaptions(input.finalOrder, input.settings.vibes, 0),
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

async function makeDraftPayloadDurable(payload: ReturnType<typeof buildDraftPayload>) {
  const photoCache = new Map<string, Promise<Photo>>();
  const durablePhoto = (photo: Photo) => {
    const key = photo.id;
    const existing = photoCache.get(key);
    if (existing) return existing;
    const next = toDurablePhoto(photo);
    photoCache.set(key, next);
    return next;
  };

  const finalOrder = await Promise.all(payload.finalOrder.map(durablePhoto));
  const removed = await Promise.all(
    payload.removed.map(async (entry) => ({
      ...entry,
      photo: await durablePhoto(entry.photo),
    })),
  );

  const byId = new Map<string, Photo>();
  for (const photo of payload.uploadedPhotos) byId.set(photo.id, photo);
  for (const photo of finalOrder) byId.set(photo.id, photo);
  for (const entry of removed) byId.set(entry.photo.id, entry.photo);

  return {
    ...payload,
    uploadedPhotos: Array.from(byId.values()),
    finalOrder,
    removed,
  };
}

async function toDurablePhoto(photo: Photo): Promise<Photo> {
  if (photo.sourceMetadata?.previewStoragePath || photo.previewStoragePath) {
    const originalStoragePath =
      photo.sourceMetadata?.originalStoragePath ?? photo.originalStoragePath;
    const previewStoragePath = photo.sourceMetadata?.previewStoragePath ?? photo.previewStoragePath;
    return {
      ...photo,
      url: "",
      originalFileUrl: undefined,
      previewFileUrl: undefined,
      previewUrl: undefined,
      storageBucket: photo.sourceMetadata?.storageBucket ?? photo.storageBucket,
      originalStoragePath,
      previewStoragePath,
      sourceMetadata: {
        ...photo.sourceMetadata,
        storageBucket: photo.sourceMetadata?.storageBucket ?? photo.storageBucket,
        originalStoragePath,
        previewStoragePath,
        originalFileUrl: undefined,
        previewFileUrl: undefined,
      },
    };
  }
  const source = photo.previewUrl ?? photo.previewFileUrl ?? photo.url;
  const durableUrl = await durableUrlFor(source);
  if (!durableUrl) return photo;
  const originalFileUrl = photo.originalFileUrl?.startsWith("blob:")
    ? undefined
    : photo.originalFileUrl;
  return {
    ...photo,
    url: durableUrl,
    previewUrl: durableUrl,
    previewFileUrl: durableUrl,
    originalFileUrl,
    sourceMetadata: {
      ...photo.sourceMetadata,
      previewFileUrl: durableUrl,
      originalFileUrl: originalFileUrl ?? photo.sourceMetadata?.originalFileUrl,
    },
  };
}

async function durableUrlFor(url: string | undefined): Promise<string | null> {
  if (!url || !url.startsWith("blob:")) return null;
  try {
    const blob = await fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Could not read draft preview: ${response.status}`);
      return response.blob();
    });
    return await blobToDataUrl(blob);
  } catch (error) {
    console.warn("[dumpdeck] could not make draft photo URL durable", error);
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not encode draft image"));
    reader.readAsDataURL(blob);
  });
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
