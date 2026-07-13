import { supabase } from "@/integrations/supabase/client";
import type { Photo } from "../types";
import type { CachedImageMetadata } from "./types";

const METADATA_TABLE = "image_metadata";
const OBJECTS_TABLE = "image_objects";
const EMBEDDINGS_TABLE = "image_embeddings";
const RANKINGS_TABLE = "image_rankings";

type ImageMetadataRow = {
  user_id: string;
  fingerprint: string;
  pipeline_version: string;
  analysis: CachedImageMetadata["analysis"];
  image_quality: CachedImageMetadata["imageQuality"];
  classification: CachedImageMetadata["classification"];
  scene_analysis: CachedImageMetadata["sceneAnalysis"];
  face_analysis: CachedImageMetadata["faceAnalysis"];
  detected_object_count: number;
  aesthetic_score: CachedImageMetadata["aestheticScore"];
  aesthetic_score_value: number;
  clip_embedding: CachedImageMetadata["clipEmbedding"];
  clip_embedding_stored: boolean;
  duplicate_cluster_id: string | null;
  analysis_object: CachedImageMetadata["unifiedAnalysis"] | null;
  original_file_url?: string | null;
  preview_file_url?: string | null;
  mime_type?: string | null;
  original_mime_type?: string | null;
  converted_from_heic?: boolean | null;
  conversion_quality?: number | null;
  conversion_decoder?: string | null;
  original_byte_size?: number | null;
  preview_byte_size?: number | null;
  updated_at?: string;
};

type ImageObjectRow = {
  user_id: string;
  fingerprint: string;
  pipeline_version: string;
  object_index: number;
  label: string;
  label_normalized: string;
  confidence: number;
  box_2d: CachedImageMetadata["detectedObjects"][number]["box2d"] | null;
  model: string;
  updated_at?: string;
};

type ImageEmbeddingRow = {
  user_id: string;
  fingerprint: string;
  pipeline_version: string;
  embedding_model: string;
  embedding_model_version: string;
  dimensions: number;
  embedding: string;
  updated_at?: string;
};

type ImageRankingRow = {
  user_id: string;
  fingerprint: string;
  pipeline_version: string;
  ranking_model: string;
  ranking_model_version: string;
  keep_score: number;
  delete_score: number;
  confidence: number;
  explanation: string;
  recommendation: NonNullable<Photo["ranking"]>["recommendation"];
  duplicate_cluster_id: string | null;
  duplicate_cluster_best_photo_id: string | null;
  best_in_duplicate_cluster: boolean;
  duplicate_cluster_rank: number;
  overall_rank: number;
  overall_score: number;
  ranking: NonNullable<Photo["ranking"]>;
  updated_at?: string;
};

export type SimilarImageMatch = {
  fingerprint: string;
  pipelineVersion: string;
  similarity: number;
};

export type DuplicateClusterAssignment = {
  fingerprint: string;
  pipelineVersion: string;
  duplicateClusterId: string;
};

export async function getCachedImageMetadata(
  fingerprint: string | undefined,
  pipelineVersion: string,
): Promise<CachedImageMetadata | null> {
  if (!fingerprint) return null;
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from(METADATA_TABLE)
    .select(
      "fingerprint,pipeline_version,analysis,image_quality,classification,scene_analysis,face_analysis,detected_object_count,aesthetic_score,aesthetic_score_value,clip_embedding,clip_embedding_stored,duplicate_cluster_id,analysis_object,original_file_url,preview_file_url,mime_type,original_mime_type,converted_from_heic,conversion_quality,conversion_decoder,original_byte_size,preview_byte_size",
    )
    .eq("user_id", userId)
    .eq("fingerprint", fingerprint)
    .eq("pipeline_version", pipelineVersion)
    .maybeSingle();

  if (error) {
    console.warn("[pipeline] Supabase metadata cache read failed", error);
    return null;
  }
  if (!data) return null;

  const row = data as ImageMetadataRow;
  if (
    !row.image_quality ||
    !row.scene_analysis ||
    !row.face_analysis ||
    !row.aesthetic_score ||
    !row.clip_embedding
  ) {
    return null;
  }

  return {
    fingerprint: row.fingerprint,
    pipelineVersion: row.pipeline_version,
    analysis: row.analysis,
    imageQuality: row.image_quality,
    classification: row.classification,
    sceneAnalysis: row.scene_analysis,
    faceAnalysis: row.face_analysis,
    aestheticScore: row.aesthetic_score,
    clipEmbedding: {
      ...row.clip_embedding,
      stored: row.clip_embedding_stored,
    },
    unifiedAnalysis: row.analysis_object ?? undefined,
    detectedObjects: [],
    detectedObjectCount: row.detected_object_count ?? 0,
    sourceMetadata: {
      originalFileUrl: row.original_file_url ?? undefined,
      previewFileUrl: row.preview_file_url ?? undefined,
      mimeType: row.mime_type ?? undefined,
      originalMimeType: row.original_mime_type ?? undefined,
      convertedFromHeic: row.converted_from_heic ?? undefined,
      conversionQuality: row.conversion_quality ?? undefined,
      conversionDecoder: row.conversion_decoder ?? undefined,
      originalByteSize: row.original_byte_size ?? undefined,
      previewByteSize: row.preview_byte_size ?? undefined,
    },
  };
}

export async function getCachedDetectedObjects(
  fingerprint: string | undefined,
  pipelineVersion: string,
): Promise<CachedImageMetadata["detectedObjects"]> {
  if (!fingerprint) return [];
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from(OBJECTS_TABLE)
    .select("label,label_normalized,confidence,box_2d,model")
    .eq("user_id", userId)
    .eq("fingerprint", fingerprint)
    .eq("pipeline_version", pipelineVersion)
    .order("object_index", { ascending: true });

  if (error) {
    console.warn("[pipeline] Supabase object cache read failed", error);
    return [];
  }

  return (
    (data ?? []) as Pick<
      ImageObjectRow,
      "label" | "label_normalized" | "confidence" | "box_2d" | "model"
    >[]
  ).map((row) => ({
    label: row.label,
    labelNormalized: row.label_normalized,
    confidence: row.confidence,
    box2d: row.box_2d ?? undefined,
    model: row.model,
  }));
}

export async function hasCachedClipEmbedding(
  fingerprint: string | undefined,
  pipelineVersion: string,
): Promise<boolean> {
  if (!fingerprint) return false;
  const userId = await getCurrentUserId();
  if (!userId) return false;

  const { data, error } = await supabase
    .from(EMBEDDINGS_TABLE)
    .select("fingerprint")
    .eq("user_id", userId)
    .eq("fingerprint", fingerprint)
    .eq("pipeline_version", pipelineVersion)
    .maybeSingle();

  if (error) {
    console.warn("[pipeline] Supabase embedding cache read failed", error);
    return false;
  }
  return !!data;
}

export async function getCachedClipEmbeddingVector(
  fingerprint: string | undefined,
  pipelineVersion: string,
): Promise<number[] | undefined> {
  if (!fingerprint) return undefined;
  const userId = await getCurrentUserId();
  if (!userId) return undefined;

  const { data, error } = await supabase
    .from(EMBEDDINGS_TABLE)
    .select("embedding")
    .eq("user_id", userId)
    .eq("fingerprint", fingerprint)
    .eq("pipeline_version", pipelineVersion)
    .maybeSingle();

  if (error) {
    console.warn("[pipeline] Supabase embedding vector read failed", error);
    return undefined;
  }

  return parseVector((data as { embedding?: unknown } | null)?.embedding);
}

export async function saveCachedImageMetadata(metadata: CachedImageMetadata): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const row: ImageMetadataRow = {
    user_id: userId,
    fingerprint: metadata.fingerprint,
    pipeline_version: metadata.pipelineVersion,
    analysis: metadata.analysis,
    image_quality: metadata.imageQuality,
    classification: metadata.classification,
    scene_analysis: metadata.sceneAnalysis,
    face_analysis: metadata.faceAnalysis,
    detected_object_count: metadata.detectedObjects.length,
    aesthetic_score: metadata.aestheticScore,
    aesthetic_score_value: metadata.aestheticScore.score,
    clip_embedding: metadata.clipEmbedding,
    clip_embedding_stored: metadata.clipEmbedding.stored,
    duplicate_cluster_id: null,
    analysis_object: metadata.unifiedAnalysis ?? null,
    original_file_url: metadata.sourceMetadata?.originalFileUrl ?? null,
    preview_file_url: metadata.sourceMetadata?.previewFileUrl ?? null,
    mime_type: metadata.sourceMetadata?.mimeType ?? null,
    original_mime_type: metadata.sourceMetadata?.originalMimeType ?? null,
    converted_from_heic: metadata.sourceMetadata?.convertedFromHeic ?? false,
    conversion_quality: metadata.sourceMetadata?.conversionQuality ?? null,
    conversion_decoder: metadata.sourceMetadata?.conversionDecoder ?? null,
    original_byte_size: metadata.sourceMetadata?.originalByteSize ?? null,
    preview_byte_size: metadata.sourceMetadata?.previewByteSize ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(METADATA_TABLE).upsert(row, {
    onConflict: "user_id,fingerprint,pipeline_version",
  });

  if (error) {
    console.warn("[pipeline] Supabase metadata cache write failed", error);
  }
}

export async function saveDuplicateClusterAssignments(
  photos: Photo[],
  pipelineVersion: string,
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const rows = photos
    .filter((photo) => photo.fingerprint && photo.duplicateClusterId)
    .map((photo) => ({
      user_id: userId,
      fingerprint: photo.fingerprint!,
      pipeline_version: pipelineVersion,
      duplicate_cluster_id: photo.duplicateClusterId!,
      updated_at: new Date().toISOString(),
    }));

  if (!rows.length) return;

  const { error } = await supabase.from("image_duplicate_clusters").upsert(rows, {
    onConflict: "user_id,fingerprint,pipeline_version",
  });

  if (error) {
    console.warn("[pipeline] Supabase duplicate cluster write failed", error);
  }

  await Promise.all(
    rows.map((row) =>
      supabase
        .from(METADATA_TABLE)
        .update({ duplicate_cluster_id: row.duplicate_cluster_id })
        .eq("user_id", userId)
        .eq("fingerprint", row.fingerprint)
        .eq("pipeline_version", pipelineVersion),
    ),
  );
}

export async function savePhotoRankings(photos: Photo[], pipelineVersion: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const rows = photos
    .filter(
      (photo): photo is Photo & { fingerprint: string; ranking: NonNullable<Photo["ranking"]> } =>
        Boolean(photo.fingerprint && photo.ranking),
    )
    .map((photo) => ({
      user_id: userId,
      fingerprint: photo.fingerprint,
      pipeline_version: pipelineVersion,
      ranking_model: photo.ranking.model,
      ranking_model_version: photo.ranking.modelVersion,
      keep_score: photo.ranking.keepScore,
      delete_score: photo.ranking.deleteScore,
      confidence: photo.ranking.confidence,
      explanation: photo.ranking.explanation,
      recommendation: photo.ranking.recommendation,
      duplicate_cluster_id: photo.duplicateClusterId ?? null,
      duplicate_cluster_best_photo_id: photo.ranking.duplicateClusterBestPhotoId ?? null,
      best_in_duplicate_cluster: photo.ranking.bestInDuplicateCluster,
      duplicate_cluster_rank: photo.ranking.duplicateClusterRank,
      overall_rank: photo.ranking.overallRank,
      overall_score: photo.ranking.overallScore,
      ranking: photo.ranking,
      updated_at: new Date().toISOString(),
    })) satisfies ImageRankingRow[];

  if (!rows.length) return;

  const { error } = await supabase.from(RANKINGS_TABLE).upsert(rows, {
    onConflict: "user_id,fingerprint,pipeline_version,ranking_model_version",
  });

  if (error) {
    console.warn("[pipeline] Supabase ranking write failed", error);
  }

  await Promise.all(
    photos
      .filter((photo) => photo.fingerprint && photo.unifiedAnalysis)
      .map((photo) =>
        supabase
          .from(METADATA_TABLE)
          .update({
            analysis_object: photo.unifiedAnalysis!,
            duplicate_cluster_id: photo.duplicateClusterId ?? null,
          })
          .eq("user_id", userId)
          .eq("fingerprint", photo.fingerprint!)
          .eq("pipeline_version", pipelineVersion),
      ),
  );
}

export async function saveCachedClipEmbedding(metadata: CachedImageMetadata): Promise<void> {
  if (!metadata.clipEmbeddingVector || !metadata.clipEmbedding.modelAvailable) return;
  const userId = await getCurrentUserId();
  if (!userId) return;

  const row: ImageEmbeddingRow = {
    user_id: userId,
    fingerprint: metadata.fingerprint,
    pipeline_version: metadata.pipelineVersion,
    embedding_model: metadata.clipEmbedding.model,
    embedding_model_version: metadata.clipEmbedding.modelVersion,
    dimensions: metadata.clipEmbedding.dimensions,
    embedding: vectorToSql(metadata.clipEmbeddingVector),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(EMBEDDINGS_TABLE).upsert(row, {
    onConflict: "user_id,fingerprint,pipeline_version",
  });

  if (error) {
    console.warn("[pipeline] Supabase embedding cache write failed", error);
  } else {
    metadata.clipEmbedding.stored = true;
  }
}

export async function findSimilarImagesByEmbedding(
  embedding: number[],
  options: { matchCount?: number; minSimilarity?: number } = {},
): Promise<SimilarImageMatch[]> {
  const { data, error } = await supabase.rpc("match_image_embeddings", {
    query_embedding: vectorToSql(embedding),
    match_count: options.matchCount ?? 20,
    min_similarity: options.minSimilarity ?? 0,
  });

  if (error) {
    console.warn("[pipeline] Supabase similarity search failed", error);
    return [];
  }

  return (
    (data ?? []) as {
      fingerprint: string;
      pipeline_version: string;
      similarity: number;
    }[]
  ).map((row) => ({
    fingerprint: row.fingerprint,
    pipelineVersion: row.pipeline_version,
    similarity: row.similarity,
  }));
}

export async function findSimilarImagesByFingerprint(
  fingerprint: string,
  options: { matchCount?: number; minSimilarity?: number } = {},
): Promise<SimilarImageMatch[]> {
  const { data, error } = await supabase.rpc("match_similar_images", {
    anchor_fingerprint: fingerprint,
    match_count: options.matchCount ?? 20,
    min_similarity: options.minSimilarity ?? 0,
  });

  if (error) {
    console.warn("[pipeline] Supabase fingerprint similarity search failed", error);
    return [];
  }

  return (
    (data ?? []) as {
      fingerprint: string;
      pipeline_version: string;
      similarity: number;
    }[]
  ).map((row) => ({
    fingerprint: row.fingerprint,
    pipelineVersion: row.pipeline_version,
    similarity: row.similarity,
  }));
}

export async function saveCachedDetectedObjects(metadata: CachedImageMetadata): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const fingerprint = metadata.fingerprint;
  const pipelineVersion = metadata.pipelineVersion;
  const { error: deleteError } = await supabase
    .from(OBJECTS_TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("fingerprint", fingerprint)
    .eq("pipeline_version", pipelineVersion);

  if (deleteError) {
    console.warn("[pipeline] Supabase object cache delete failed", deleteError);
    return;
  }

  if (metadata.detectedObjects.length === 0) return;

  const now = new Date().toISOString();
  const rows: ImageObjectRow[] = metadata.detectedObjects.map((object, objectIndex) => ({
    user_id: userId,
    fingerprint,
    pipeline_version: pipelineVersion,
    object_index: objectIndex,
    label: object.label,
    label_normalized: object.labelNormalized,
    confidence: object.confidence,
    box_2d: object.box2d ?? null,
    model: object.model,
    updated_at: now,
  }));

  const { error } = await supabase.from(OBJECTS_TABLE).insert(rows);
  if (error) {
    console.warn("[pipeline] Supabase object cache write failed", error);
  }
}

function vectorToSql(vector: number[]) {
  return `[${vector.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

function parseVector(value: unknown): number[] | undefined {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/^\[/, "").replace(/\]$/, "");
  if (!trimmed) return undefined;
  const vector = trimmed.split(",").map((part) => Number(part.trim()));
  return vector.every(Number.isFinite) ? vector : undefined;
}

async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("[pipeline] Supabase auth lookup failed", error);
    return null;
  }
  return data.session?.user.id ?? null;
}
