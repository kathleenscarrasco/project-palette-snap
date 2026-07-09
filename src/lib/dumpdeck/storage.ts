import { isLocalDevAuth, supabase } from "@/integrations/supabase/client";
import type { FinalDraftPayload, SavedFinalDraft } from "./drafts";
import type { Photo, RemovedPhoto, UploadItem } from "./types";

export const DUMPDECK_PHOTOS_BUCKET = "dumpdeck-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;
const STORAGE_UPLOAD_CONCURRENCY = 4;
const STORAGE_MAX_IMAGE_SIDE = 2048;
const STORAGE_JPEG_QUALITY = 0.9;

type StoredPhotoRow = {
  id: string;
  user_id: string;
  project_id: string;
  storage_bucket?: string | null;
  original_storage_path?: string | null;
  preview_storage_path?: string | null;
  file_name?: string | null;
  original_file_url?: string | null;
  preview_file_url?: string | null;
  mime_type?: string | null;
  original_mime_type?: string | null;
  converted_from_heic?: boolean | null;
  conversion_quality?: number | null;
  width?: number | null;
  height?: number | null;
  file_size?: number | null;
  fingerprint?: string | null;
  uploaded_at?: string | null;
  source_metadata?: Record<string, unknown> | null;
};

type ProjectPhotoSummary = {
  projectId: string;
  count: number;
  firstPhotoUrl: string | null;
};

type PersistablePhoto = UploadItem | Photo;

export async function persistProjectUploads(
  projectId: string | null | undefined,
  items: UploadItem[],
): Promise<UploadItem[]> {
  if (isLocalDevAuth || !projectId || !items.length) return items;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Sign in before uploading photos.");

  const userId = userData.user.id;
  const stored: UploadItem[] = [];

  const startedAt = performance.now();
  const results = await mapWithConcurrency(items, STORAGE_UPLOAD_CONCURRENCY, async (item) => {
    const itemStartedAt = performance.now();
    const originalSourceUrl = item.convertedFromHeic
      ? item.previewUrl ?? item.previewFileUrl ?? item.url
      : item.originalFileUrl ?? item.url;
    const originalBlobRaw = await blobFromUrl(originalSourceUrl);
    const previewBlobRaw = await blobFromUrl(item.previewUrl ?? item.previewFileUrl ?? item.url);
    const originalBlob = await optimizeImageBlob(originalBlobRaw, {
      maxSide: STORAGE_MAX_IMAGE_SIDE,
      quality: STORAGE_JPEG_QUALITY,
      label: `${item.name}:original`,
    });
    const previewBlob = await optimizeImageBlob(previewBlobRaw, {
      maxSide: 1600,
      quality: STORAGE_JPEG_QUALITY,
      label: `${item.name}:preview`,
    });
    const originalExt = extensionForMime(
      item.originalMimeType ?? originalBlob.type ?? item.mimeType,
      item.name,
    );
    const previewExt = extensionForMime(previewBlob.type || item.mimeType, "preview.jpg");
    const basePath = `${userId}/${projectId}/${item.id}`;
    const originalPath = `${basePath}/original.${originalExt}`;
    const previewPath = `${basePath}/preview.${previewExt}`;

    await uploadObject(originalPath, originalBlob, item.originalMimeType ?? originalBlob.type);
    await uploadObject(previewPath, previewBlob, previewBlob.type || item.mimeType || "image/jpeg");

    const signed = await signedUrlsForPaths([originalPath, previewPath]);
    const originalSignedUrl = signed.get(originalPath) ?? item.originalFileUrl ?? item.url;
    const previewSignedUrl = signed.get(previewPath) ?? item.previewUrl ?? item.url;
    const uploadedAt = new Date().toISOString();
    const next: UploadItem = {
      ...item,
      url: previewSignedUrl,
      originalFileUrl: originalSignedUrl,
      previewFileUrl: previewSignedUrl,
      previewUrl: previewSignedUrl,
      storageBucket: DUMPDECK_PHOTOS_BUCKET,
      originalStoragePath: originalPath,
      previewStoragePath: previewPath,
      fileName: item.name,
      uploadedAt,
    };

    await upsertStoredPhoto({
      item: next,
      userId,
      projectId,
      originalPath,
      previewPath,
      originalBlob,
      previewBlob,
      uploadedAt,
    });
    console.debug("[perf] storage upload item complete", {
      projectId,
      id: item.id,
      name: item.name,
      convertedFromHeic: item.convertedFromHeic,
      originalBytes: originalBlobRaw.size,
      storedOriginalBytes: originalBlob.size,
      previewBytes: previewBlob.size,
      storageUploadMs: Math.round(performance.now() - itemStartedAt),
    });
    return next;
  });
  stored.push(...results);

  console.debug("[dumpdeck] uploaded photos to Supabase Storage", {
    projectId,
    bucket: DUMPDECK_PHOTOS_BUCKET,
    count: stored.length,
    storageUploadTotalMs: Math.round(performance.now() - startedAt),
    storageUploadConcurrency: STORAGE_UPLOAD_CONCURRENCY,
    paths: stored.map((item) => ({
      id: item.id,
      originalStoragePath: item.originalStoragePath,
      previewStoragePath: item.previewStoragePath,
    })),
  });

  return stored;
}

export async function persistFinalDraftPhotos(
  projectId: string | null | undefined,
  photos: Photo[],
): Promise<Map<string, Photo>> {
  const byId = new Map<string, Photo>();
  for (const photo of photos) byId.set(photo.id, photo);
  if (isLocalDevAuth || !projectId || !byId.size) return byId;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Sign in before saving photos.");

  const userId = userData.user.id;
  const stored = new Map<string, Photo>();
  const startedAt = performance.now();

  const results = await mapWithConcurrency(
    Array.from(byId.values()),
    STORAGE_UPLOAD_CONCURRENCY,
    async (photo) => {
      const itemStartedAt = performance.now();
      if (photo.sourceMetadata?.previewStoragePath || photo.previewStoragePath) {
        console.debug("[perf] storage upload skipped existing photo", {
          projectId,
          id: photo.id,
          name: photo.name,
        });
        return photo;
      }

      const convertedFromHeic =
        photo.sourceMetadata?.convertedFromHeic || /\.(heic|heif)$/i.test(photo.name);
      const sourceUrl = photo.originalFileUrl ?? photo.sourceMetadata?.originalFileUrl ?? photo.url;
      const previewUrl =
        photo.previewUrl ??
        photo.previewFileUrl ??
        photo.sourceMetadata?.previewFileUrl ??
        photo.url;
      const originalSourceUrl = convertedFromHeic ? previewUrl : sourceUrl;
      const originalBlobRaw = await blobFromUrl(originalSourceUrl);
      const previewBlobRaw = await blobFromUrl(previewUrl);
      const originalBlob = await optimizeImageBlob(originalBlobRaw, {
        maxSide: STORAGE_MAX_IMAGE_SIDE,
        quality: STORAGE_JPEG_QUALITY,
        label: `${photo.name}:draft-original`,
      });
      const previewBlob = await optimizeImageBlob(previewBlobRaw, {
        maxSide: 1600,
        quality: STORAGE_JPEG_QUALITY,
        label: `${photo.name}:draft-preview`,
      });
      const originalMimeType =
        convertedFromHeic
          ? originalBlob.type || "image/jpeg"
          : photo.sourceMetadata?.originalMimeType ??
            originalBlob.type ??
            photo.sourceMetadata?.mimeType;
      const previewMimeType =
        photo.sourceMetadata?.mimeType ?? previewBlob.type ?? originalMimeType ?? "image/jpeg";
      const originalExt = extensionForMime(originalMimeType, photo.name);
      const previewExt = extensionForMime(previewMimeType, "preview.jpg");
      const basePath = `${userId}/${projectId}/${photo.id}`;
      const originalPath = `${basePath}/original.${originalExt}`;
      const previewPath = `${basePath}/preview.${previewExt}`;

      await uploadObject(originalPath, originalBlob, originalMimeType);
      await uploadObject(previewPath, previewBlob, previewMimeType);

      const signed = await signedUrlsForPaths([originalPath, previewPath]);
      const originalSignedUrl = signed.get(originalPath) ?? sourceUrl;
      const previewSignedUrl = signed.get(previewPath) ?? previewUrl;
      const uploadedAt = new Date().toISOString();
      const next: Photo = {
        ...photo,
        url: previewSignedUrl,
        originalFileUrl: originalSignedUrl,
        previewFileUrl: previewSignedUrl,
        previewUrl: previewSignedUrl,
        storageBucket: DUMPDECK_PHOTOS_BUCKET,
        originalStoragePath: originalPath,
        previewStoragePath: previewPath,
        fileName: photo.name,
        uploadedAt,
        sourceMetadata: {
          ...photo.sourceMetadata,
          storageBucket: DUMPDECK_PHOTOS_BUCKET,
          originalStoragePath: originalPath,
          previewStoragePath: previewPath,
          fileName: photo.name,
          uploadedAt,
          originalMimeType,
          mimeType: previewMimeType,
          originalFileUrl: originalSignedUrl,
          previewFileUrl: previewSignedUrl,
        },
      };

      await upsertStoredPhoto({
        item: next,
        userId,
        projectId,
        originalPath,
        previewPath,
        originalBlob,
        previewBlob,
        uploadedAt,
      });
      console.debug("[perf] final draft storage item complete", {
        projectId,
        id: photo.id,
        name: photo.name,
        convertedFromHeic,
        sourceBytes: originalBlobRaw.size,
        storedOriginalBytes: originalBlob.size,
        previewBytes: previewBlob.size,
        storageUploadMs: Math.round(performance.now() - itemStartedAt),
      });
      return next;
    },
  );

  for (const photo of results) stored.set(photo.id, photo);

  console.debug("[dumpdeck] saved final draft photos to Supabase Storage", {
    projectId,
    bucket: DUMPDECK_PHOTOS_BUCKET,
    count: stored.size,
    storageUploadTotalMs: Math.round(performance.now() - startedAt),
    storageUploadConcurrency: STORAGE_UPLOAD_CONCURRENCY,
    paths: Array.from(stored.values()).map((photo) => ({
      id: photo.id,
      originalStoragePath: photo.originalStoragePath,
      previewStoragePath: photo.previewStoragePath,
    })),
  });

  return stored;
}

export async function hydrateStoredDrafts(drafts: SavedFinalDraft[]): Promise<SavedFinalDraft[]> {
  if (isLocalDevAuth || !drafts.length) return drafts;
  const startedAt = performance.now();
  const projectIds = Array.from(
    new Set(drafts.map((draft) => draft.projectId).filter((id): id is string => Boolean(id))),
  );
  if (!projectIds.length) return drafts;

  const rows = await loadStoredPhotoRows(projectIds);
  const signed = await signedUrlsForRows(rows);
  const rowKey = (projectId: string | null, photoId: string) => `${projectId ?? ""}:${photoId}`;
  const rowsByProjectPhoto = new Map(
    rows.map((row) => [rowKey(row.project_id, row.id), row] as const),
  );

  const hydrated = drafts.map((draft) => {
    if (!draft.draftPayload) return draft;
    const hydratePhoto = (photo: Photo) => {
      const row = rowsByProjectPhoto.get(rowKey(draft.projectId, photo.id));
      return row ? mergeSignedUrls(photo, row, signed) : photo;
    };
    const payload = draft.draftPayload;
    return {
      ...draft,
      draftPayload: {
        ...payload,
        uploadedPhotos: payload.uploadedPhotos.map(hydratePhoto),
        shortlist: payload.shortlist?.map(hydratePhoto),
        kept: payload.kept?.map(hydratePhoto),
        finalOrder: payload.finalOrder.map(hydratePhoto),
        removed: payload.removed.map((entry) => ({
          ...entry,
          photo: hydratePhoto(entry.photo),
        })),
      },
    };
  });
  console.debug("[dumpdeck] hydrated stored draft photos", {
    draftCount: drafts.length,
    projectIds,
    storedPhotoRows: rows.length,
    signedUrlsGenerated: signed.size,
    drafts: hydrated.map((draft) => ({
      draftId: draft.id,
      projectId: draft.projectId,
      finalSelectedPhotoCount: draft.draftPayload?.finalOrder?.length ?? 0,
      finalOrderPhotoIds: draft.draftPayload?.orderedPhotoIds ?? draft.orderedPhotoIds,
      pinnedCoverPhotoId:
        draft.draftPayload?.pinnedCoverPhotoId ?? draft.selectedPreferences?.pinnedCoverPhotoId,
      storagePathsLoaded:
        draft.draftPayload?.finalOrder.filter(
          (photo) => photo.previewStoragePath || photo.sourceMetadata?.previewStoragePath,
        ).length ?? 0,
      signedUrlsLoaded:
        draft.draftPayload?.finalOrder.filter((photo) => photo.previewUrl || photo.url).length ?? 0,
    })),
    signedUrlGenerationMs: Math.round(performance.now() - startedAt),
  });
  return hydrated;
}

export async function listProjectPhotoSummaries(): Promise<Map<string, ProjectPhotoSummary>> {
  if (isLocalDevAuth) return new Map();
  const startedAt = performance.now();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return new Map();

  const { data, error } = await supabase
    .from("saved_project_photos")
    .select("id,project_id,preview_storage_path,original_storage_path,preview_file_url,created_at")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[dumpdeck] project photo summary load failed", error);
    return new Map();
  }

  const rows = (data ?? []) as Array<{
    id: string;
    project_id: string;
    preview_storage_path?: string | null;
    original_storage_path?: string | null;
    preview_file_url?: string | null;
  }>;
  const paths = rows
    .map((row) => row.preview_storage_path ?? row.original_storage_path)
    .filter((path): path is string => Boolean(path));
  const signed = await signedUrlsForPaths(paths);
  const summaries = new Map<string, ProjectPhotoSummary>();
  for (const row of rows) {
    const existing = summaries.get(row.project_id);
    const path = row.preview_storage_path ?? row.original_storage_path ?? "";
    const url = signed.get(path) ?? row.preview_file_url ?? null;
    summaries.set(row.project_id, {
      projectId: row.project_id,
      count: (existing?.count ?? 0) + 1,
      firstPhotoUrl: existing?.firstPhotoUrl ?? url,
    });
  }
  console.debug("[perf] project photo summaries loaded", {
    projects: summaries.size,
    rows: rows.length,
    signedUrlsGenerated: signed.size,
    signedUrlGenerationMs: Math.round(performance.now() - startedAt),
  });
  return summaries;
}

export async function copyStoredProjectPhotosForDraft(
  sourceProjectId: string | null | undefined,
  targetProjectId: string,
  photoIds: string[],
): Promise<void> {
  if (isLocalDevAuth || !sourceProjectId || !photoIds.length) return;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Sign in before duplicating.");

  const { data, error } = await supabase
    .from("saved_project_photos")
    .select("*")
    .eq("user_id", userData.user.id)
    .eq("project_id", sourceProjectId)
    .in("id", photoIds);
  if (error) throw error;

  const rows = (data ?? []) as StoredPhotoRow[];
  const copiedRows: Record<string, unknown>[] = [];
  for (const row of rows) {
    const nextOriginalPath = row.original_storage_path
      ? row.original_storage_path.replace(`/${sourceProjectId}/`, `/${targetProjectId}/`)
      : null;
    const nextPreviewPath = row.preview_storage_path
      ? row.preview_storage_path.replace(`/${sourceProjectId}/`, `/${targetProjectId}/`)
      : null;
    await copyObjectIfNeeded(row.original_storage_path, nextOriginalPath);
    await copyObjectIfNeeded(row.preview_storage_path, nextPreviewPath);
    copiedRows.push({
      ...row,
      project_id: targetProjectId,
      original_storage_path: nextOriginalPath,
      preview_storage_path: nextPreviewPath,
      original_file_url: null,
      preview_file_url: null,
      uploaded_at: new Date().toISOString(),
      source_metadata: {
        ...(row.source_metadata ?? {}),
        storageBucket: DUMPDECK_PHOTOS_BUCKET,
        originalStoragePath: nextOriginalPath,
        previewStoragePath: nextPreviewPath,
      },
    });
  }

  if (copiedRows.length) {
    const { error: insertError } = await supabase
      .from("saved_project_photos")
      .upsert(copiedRows, { onConflict: "project_id,id" });
    if (insertError) throw insertError;
  }
}

export async function deleteStoredProjectPhotos(projectId: string): Promise<void> {
  if (isLocalDevAuth) return;
  const rows = await loadStoredPhotoRows([projectId]);
  const paths = rows.flatMap((row) =>
    [row.original_storage_path, row.preview_storage_path].filter((path): path is string =>
      Boolean(path),
    ),
  );
  if (paths.length) {
    const { error } = await supabase.storage.from(DUMPDECK_PHOTOS_BUCKET).remove(paths);
    if (error) console.warn("[dumpdeck] storage cleanup failed", error);
  }
}

function mergeSignedUrls(photo: Photo, row: StoredPhotoRow, signed: Map<string, string>): Photo {
  const previewPath = row.preview_storage_path ?? undefined;
  const originalPath = row.original_storage_path ?? undefined;
  const previewUrl = (previewPath && signed.get(previewPath)) || row.preview_file_url || undefined;
  const originalUrl =
    (originalPath && signed.get(originalPath)) || row.original_file_url || undefined;
  const displayUrl = previewUrl ?? originalUrl ?? photo.url;
  return {
    ...photo,
    url: displayUrl,
    previewUrl: previewUrl ?? displayUrl,
    previewFileUrl: previewUrl ?? displayUrl,
    originalFileUrl: originalUrl,
    storageBucket: row.storage_bucket ?? DUMPDECK_PHOTOS_BUCKET,
    originalStoragePath: originalPath,
    previewStoragePath: previewPath,
    fileName: row.file_name ?? photo.name,
    uploadedAt: row.uploaded_at ?? photo.uploadedAt,
    sourceMetadata: {
      ...photo.sourceMetadata,
      storageBucket: row.storage_bucket ?? DUMPDECK_PHOTOS_BUCKET,
      originalStoragePath: originalPath,
      previewStoragePath: previewPath,
      fileName: row.file_name ?? photo.name,
      uploadedAt: row.uploaded_at ?? photo.uploadedAt,
      originalFileUrl: originalUrl,
      previewFileUrl: previewUrl,
    },
  };
}

async function upsertStoredPhoto({
  item,
  userId,
  projectId,
  originalPath,
  previewPath,
  originalBlob,
  previewBlob,
  uploadedAt,
}: {
  item: PersistablePhoto;
  userId: string;
  projectId: string;
  originalPath: string;
  previewPath: string;
  originalBlob: Blob;
  previewBlob: Blob;
  uploadedAt: string;
}) {
  const startedAt = performance.now();
  const row = {
    id: item.id,
    user_id: userId,
    project_id: projectId,
    storage_bucket: DUMPDECK_PHOTOS_BUCKET,
    original_storage_path: originalPath,
    preview_storage_path: previewPath,
    file_name: item.name,
    original_file_url: null,
    preview_file_url: null,
    mime_type: sourceMimeType(item) ?? previewBlob.type,
    original_mime_type: sourceOriginalMimeType(item) ?? originalBlob.type,
    converted_from_heic: sourceConvertedFromHeic(item),
    conversion_quality: sourceConversionQuality(item),
    width: item.width,
    height: item.height,
    file_size: sourceOriginalByteSize(item) ?? originalBlob.size,
    fingerprint: item.fingerprint ?? null,
    uploaded_at: uploadedAt,
    status: "uploaded",
    source_metadata: {
      storageBucket: DUMPDECK_PHOTOS_BUCKET,
      originalStoragePath: originalPath,
      previewStoragePath: previewPath,
      fileName: item.name,
      uploadedAt,
      originalMimeType: sourceOriginalMimeType(item),
      mimeType: sourceMimeType(item),
      convertedFromHeic: sourceConvertedFromHeic(item),
      conversionQuality: sourceConversionQuality(item),
      conversionDecoder: sourceConversionDecoder(item),
      originalByteSize: sourceOriginalByteSize(item),
      previewByteSize: sourcePreviewByteSize(item),
    },
  };
  const { error } = await supabase
    .from("saved_project_photos")
    .upsert(row, { onConflict: "project_id,id" });
  if (error) throw error;
  console.debug("[perf] saved_project_photos upsert complete", {
    projectId,
    photoId: item.id,
    upsertMs: Math.round(performance.now() - startedAt),
  });
}

function sourceMimeType(item: PersistablePhoto) {
  return "mimeType" in item ? item.mimeType : item.sourceMetadata?.mimeType;
}

function sourceOriginalMimeType(item: PersistablePhoto) {
  return "originalMimeType" in item ? item.originalMimeType : item.sourceMetadata?.originalMimeType;
}

function sourceConvertedFromHeic(item: PersistablePhoto) {
  return "convertedFromHeic" in item
    ? (item.convertedFromHeic ?? false)
    : (item.sourceMetadata?.convertedFromHeic ?? false);
}

function sourceConversionQuality(item: PersistablePhoto) {
  return "conversionQuality" in item
    ? (item.conversionQuality ?? null)
    : (item.sourceMetadata?.conversionQuality ?? null);
}

function sourceConversionDecoder(item: PersistablePhoto) {
  return "conversionDecoder" in item ? item.conversionDecoder : item.sourceMetadata?.conversionDecoder;
}

function sourceOriginalByteSize(item: PersistablePhoto) {
  return "originalByteSize" in item ? item.originalByteSize : item.sourceMetadata?.originalByteSize;
}

function sourcePreviewByteSize(item: PersistablePhoto) {
  return "previewByteSize" in item ? item.previewByteSize : item.sourceMetadata?.previewByteSize;
}

async function uploadObject(path: string, blob: Blob, contentType?: string) {
  const { error } = await supabase.storage.from(DUMPDECK_PHOTOS_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: contentType || blob.type || "application/octet-stream",
  });
  if (error) throw error;
}

async function copyObjectIfNeeded(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to || from === to) return;
  const { error } = await supabase.storage.from(DUMPDECK_PHOTOS_BUCKET).copy(from, to);
  if (error) throw error;
}

async function loadStoredPhotoRows(projectIds: string[]): Promise<StoredPhotoRow[]> {
  if (!projectIds.length) return [];
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return [];
  const { data, error } = await supabase
    .from("saved_project_photos")
    .select("*")
    .eq("user_id", userData.user.id)
    .in("project_id", projectIds);
  if (error) {
    console.warn("[dumpdeck] stored photo rows failed to load", error);
    return [];
  }
  return (data ?? []) as StoredPhotoRow[];
}

async function signedUrlsForRows(rows: StoredPhotoRow[]) {
  const paths = rows.flatMap((row) =>
    [row.original_storage_path, row.preview_storage_path].filter((path): path is string =>
      Boolean(path),
    ),
  );
  return signedUrlsForPaths(paths);
}

async function signedUrlsForPaths(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const signed = new Map<string, string>();
  if (!unique.length) return signed;
  const { data, error } = await supabase.storage
    .from(DUMPDECK_PHOTOS_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.warn("[dumpdeck] signed URL creation failed", error);
    return signed;
  }
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  }
  return signed;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function optimizeImageBlob(
  blob: Blob,
  {
    maxSide,
    quality,
    label,
  }: {
    maxSide: number;
    quality: number;
    label: string;
  },
) {
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(blob.type)) return blob;
  if (typeof document === "undefined") return blob;
  const url = URL.createObjectURL(blob);
  const startedAt = performance.now();
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode image for storage optimization."));
      image.src = url;
    });
    const largestSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (largestSide <= maxSide && blob.size < 1_500_000) return blob;
    const scale = Math.min(1, maxSide / largestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const optimized = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!optimized) return blob;
    console.debug("[perf] storage image optimized", {
      label,
      originalType: blob.type,
      originalBytes: blob.size,
      optimizedBytes: optimized.size,
      width: canvas.width,
      height: canvas.height,
      maxSide,
      quality,
      optimizeMs: Math.round(performance.now() - startedAt),
    });
    return optimized;
  } catch (err) {
    console.warn("[dumpdeck] storage image optimization skipped", { label, error: err });
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function blobFromUrl(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read photo blob: ${response.status}`);
  return response.blob();
}

function extensionForMime(mimeType: string | undefined, fileName: string) {
  const fromName = fileName
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (fromName && ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  if (/png/i.test(mimeType ?? "")) return "png";
  if (/webp/i.test(mimeType ?? "")) return "webp";
  if (/heic/i.test(mimeType ?? "")) return "heic";
  if (/heif/i.test(mimeType ?? "")) return "heif";
  if (/gif/i.test(mimeType ?? "")) return "gif";
  return "jpg";
}
