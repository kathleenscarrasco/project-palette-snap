import type { Photo, PhotoRanking, UnifiedImageAnalysis } from "../types";

export const ANALYSIS_VERSION = 1;

export function buildUnifiedAnalysis(
  photo: Photo,
  options: {
    ranking?: PhotoRanking;
    duplicateClusterId?: string;
    imageEmbeddingId?: string;
  } = {},
): UnifiedImageAnalysis {
  const ranking = options.ranking ?? photo.ranking;
  const quality = photo.imageQuality;
  const scene = photo.sceneAnalysis;
  const embeddingId =
    options.imageEmbeddingId ??
    (photo.fingerprint && photo.clipEmbedding?.stored ? `embedding:${photo.fingerprint}` : "");

  return {
    analysisVersion: ANALYSIS_VERSION,
    analysis: {
      scene: scene?.primaryScene ?? photo.photoType,
      subscene: scene?.secondaryScene ?? "unknown",
      objects: (photo.detectedObjects ?? []).map((object) => ({
        label: object.label,
        normalizedLabel: object.labelNormalized,
        confidence: object.confidence,
      })),
      peopleCount: photo.faceAnalysis?.numberOfFaces ?? photo.peopleCount,
      faces: photo.faceAnalysis?.faces ?? [],
      orientation: photo.orientation,
      technicalQuality: {
        sharpness: quality?.sharpness ?? photo.analysis.sharpness,
        blur: quality?.motionBlur ?? 1 - photo.analysis.sharpness,
        brightness: quality?.signals.brightness ?? photo.analysis.brightness,
        contrast: quality?.contrast ?? photo.analysis.contrast,
        saturation: quality?.saturation ?? photo.analysis.saturation,
        noise: quality?.noise ?? 0,
        overall: quality?.overallTechnicalQuality ?? photo.scores.quality,
      },
      aestheticScore: photo.aestheticScore?.score ?? photo.scores.aesthetic * 10,
      imageEmbeddingId: embeddingId,
      duplicateCluster: options.duplicateClusterId ?? photo.duplicateClusterId ?? "",
      rankingScore: ranking?.overallScore ?? photo.overall,
      keepRecommendation: ranking?.recommendation !== "delete",
      confidence: ranking?.confidence ?? photo.photoTypeConfidence,
      reasoning: ranking?.explanation ?? photo.reasons[0] ?? "",
      duplicate: photo.duplicateRelationship ?? {
        groupId: options.duplicateClusterId ?? photo.duplicateClusterId ?? "",
        relationship: "",
        confidence: 0,
        bestPhoto: ranking?.bestInDuplicateCluster ?? true,
        reason: "",
      },
      event: photo.eventGroup ?? {
        groupId: "",
        title: "",
        description: "",
        coverPhoto: "",
        photoCount: 0,
      },
      collection: photo.collectionGroup ?? {
        groupId: "",
        title: "",
        summary: "",
        coverPhoto: "",
        eventCount: 0,
        photoCount: 0,
      },
      bestInDuplicateCluster: ranking?.bestInDuplicateCluster ?? true,
      duplicateClusterBestPhotoId: ranking?.duplicateClusterBestPhotoId,
      overallRank: ranking?.overallRank ?? 0,
      modelTrace: {
        scene: scene?.model,
        objects: [...new Set((photo.detectedObjects ?? []).map((object) => object.model))],
        faces: photo.faceAnalysis?.model,
        quality: quality?.model,
        aesthetic: photo.aestheticScore
          ? `${photo.aestheticScore.model}:${photo.aestheticScore.modelVersion}`
          : undefined,
        embedding: photo.clipEmbedding
          ? `${photo.clipEmbedding.model}:${photo.clipEmbedding.modelVersion}`
          : undefined,
        ranking: ranking ? `${ranking.model}:${ranking.modelVersion}` : undefined,
      },
    },
  };
}

export function withUnifiedAnalysis<T extends Photo>(
  photo: T,
  options: {
    ranking?: PhotoRanking;
    duplicateClusterId?: string;
    imageEmbeddingId?: string;
  } = {},
): T {
  return {
    ...photo,
    unifiedAnalysis: buildUnifiedAnalysis(photo, options),
  };
}
