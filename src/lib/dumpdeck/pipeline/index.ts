import type { DetectedObject, FaceAnalysis, Photo, SceneAnalysis } from "../types";
import {
  getCachedClipEmbeddingVector,
  getCachedDetectedObjects,
  getCachedImageMetadata,
  hasCachedClipEmbedding,
  saveCachedClipEmbedding,
  saveCachedDetectedObjects,
  saveCachedImageMetadata,
} from "./metadata-cache";
import { aestheticScoringStage } from "./stages/aesthetic-scoring";
import { clipEmbeddingStage } from "./stages/clip-embedding";
import { imageQualityStage } from "./stages/image-quality";
import { peopleDetectionStage } from "./stages/people-detection";
import { photoClassificationStage } from "./stages/photo-classification";
import { photoScoringStage } from "./stages/photo-scoring";
import { pixelAnalysisStage } from "./stages/pixel-analysis";
import { geminiUnderstandingStage } from "./stages/gemini-understanding";
import { buildUnifiedAnalysis } from "./unified-analysis";
import type {
  CachedImageMetadata,
  CompletedPipelineResult,
  ImagePipelineContext,
  ImagePipelineInput,
  ImagePipelineStage,
} from "./types";

export const imageProcessingStages: ImagePipelineStage[] = [
  pixelAnalysisStage,
  imageQualityStage,
  peopleDetectionStage,
  photoClassificationStage,
  geminiUnderstandingStage,
  aestheticScoringStage,
  clipEmbeddingStage,
  photoScoringStage,
];

export const imageMetadataStages: ImagePipelineStage[] = [
  pixelAnalysisStage,
  imageQualityStage,
  peopleDetectionStage,
  photoClassificationStage,
  geminiUnderstandingStage,
  aestheticScoringStage,
  clipEmbeddingStage,
];

export const localProcessingStages: ImagePipelineStage[] = [
  pixelAnalysisStage,
  imageQualityStage,
  peopleDetectionStage,
  photoClassificationStage,
  aestheticScoringStage,
  clipEmbeddingStage,
  photoScoringStage,
];

export const imagePipelineVersion = imageMetadataStages
  .map((stage) => `${stage.id}:${stage.version}`)
  .join("|");

const inFlightProcesses = new Map<string, Promise<CompletedPipelineResult>>();

export async function processImage(input: ImagePipelineInput): Promise<CompletedPipelineResult> {
  const inFlightKey = input.fingerprint ? `${imagePipelineVersion}:${input.fingerprint}` : "";
  if (inFlightKey) {
    const existing = inFlightProcesses.get(inFlightKey);
    if (existing) return existing;
  }
  const promise = processImageInternal(input);
  if (inFlightKey) {
    inFlightProcesses.set(
      inFlightKey,
      promise.finally(() => {
        inFlightProcesses.delete(inFlightKey);
      }),
    );
  }
  return promise;
}

async function processImageInternal(input: ImagePipelineInput): Promise<CompletedPipelineResult> {
  const cached = await getCachedImageMetadata(input.fingerprint, imagePipelineVersion);

  if (cached) {
    const detectedObjects = await getCachedDetectedObjects(input.fingerprint, imagePipelineVersion);
    const clipEmbeddingVector = await getCachedClipEmbeddingVector(
      input.fingerprint,
      imagePipelineVersion,
    );
    const hasClipEmbedding =
      !cached.clipEmbedding.modelAvailable ||
      !!clipEmbeddingVector ||
      (await hasCachedClipEmbedding(input.fingerprint, imagePipelineVersion));
    const expectedObjects = cached.detectedObjectCount ?? 0;
    if (detectedObjects.length >= expectedObjects && hasClipEmbedding) {
      const scored = await photoScoringStage.run({
        item: input,
        settings: input.settings,
        sourceUrl: input.previewUrl ?? input.url,
        analysis: cached.analysis,
        imageQuality: cached.imageQuality,
        classification: cached.classification,
        sceneAnalysis: cached.sceneAnalysis,
        detectedObjects,
        faceAnalysis: cached.faceAnalysis,
        aestheticScore: cached.aestheticScore,
        clipEmbedding: cached.clipEmbedding,
        sourceMetadata: cached.sourceMetadata,
      });

      if (!scored.scoring) {
        throw new Error("Image scoring stage finished without scoring metadata");
      }

      const photo = buildPhoto(input, {
        ...cached,
        detectedObjects,
        scoring: scored.scoring,
      });

      return {
        photo: {
          ...photo,
          unifiedAnalysis: cached.unifiedAnalysis ?? buildUnifiedAnalysis(photo),
        },
        cache: "hit",
        clipEmbeddingVector,
      };
    }
  }

  let context: ImagePipelineContext = {
    item: input,
    settings: input.settings,
    sourceUrl: input.previewUrl ?? input.url,
    geminiRequestMeta: input.geminiRequestMeta,
  };

  for (const stage of imageProcessingStages) {
    context = await stage.run(context);
  }

  if (
    !context.analysis ||
    !context.imageQuality ||
    !context.classification ||
    !context.sceneAnalysis ||
    !context.detectedObjects ||
    !context.faceAnalysis ||
    !context.aestheticScore ||
    !context.clipEmbedding ||
    !context.scoring
  ) {
    throw new Error("Image pipeline finished without complete metadata");
  }

  const metadata: CachedImageMetadata = {
    fingerprint: input.fingerprint ?? input.id,
    pipelineVersion: imagePipelineVersion,
    analysis: context.analysis,
    imageQuality: context.imageQuality,
    classification: context.classification,
    sceneAnalysis: context.sceneAnalysis,
    detectedObjects: context.detectedObjects,
    faceAnalysis: context.faceAnalysis,
    aestheticScore: context.aestheticScore,
    clipEmbedding: context.clipEmbedding,
    clipEmbeddingVector: context.clipEmbeddingVector,
    detectedObjectCount: context.detectedObjects.length,
    sourceMetadata: sourceMetadataFromInput(input),
  };

  const photo = buildPhoto(input, {
    ...metadata,
    scoring: context.scoring,
  });
  metadata.unifiedAnalysis = buildUnifiedAnalysis(photo);

  if (input.fingerprint) {
    await saveCachedClipEmbedding(metadata);
    metadata.unifiedAnalysis = buildUnifiedAnalysis({
      ...photo,
      clipEmbedding: metadata.clipEmbedding,
    });
    await Promise.all([saveCachedImageMetadata(metadata), saveCachedDetectedObjects(metadata)]);
  }

  return {
    photo: {
      ...photo,
      clipEmbedding: metadata.clipEmbedding,
      unifiedAnalysis: metadata.unifiedAnalysis,
    },
    cache: input.fingerprint ? "miss" : "skipped",
    clipEmbeddingVector: context.clipEmbeddingVector,
  };
}

export async function processLocalImage(
  input: ImagePipelineInput,
): Promise<CompletedPipelineResult> {
  let context: ImagePipelineContext = {
    item: input,
    settings: input.settings,
    sourceUrl: input.previewUrl ?? input.url,
  };

  for (const stage of localProcessingStages) {
    context = await stage.run(context);
  }

  if (
    !context.analysis ||
    !context.imageQuality ||
    !context.classification ||
    !context.aestheticScore ||
    !context.clipEmbedding ||
    !context.scoring
  ) {
    throw new Error("Local image pipeline finished without complete metadata");
  }

  const metadata: CachedImageMetadata & {
    scoring: NonNullable<ImagePipelineContext["scoring"]>;
  } = {
    fingerprint: input.fingerprint ?? input.id,
    pipelineVersion: `local:${imagePipelineVersion}`,
    analysis: context.analysis,
    imageQuality: context.imageQuality,
    classification: context.classification,
    sceneAnalysis: fallbackSceneAnalysis(context),
    detectedObjects: fallbackDetectedObjects(context),
    faceAnalysis: fallbackFaceAnalysis(context),
    aestheticScore: context.aestheticScore,
    clipEmbedding: context.clipEmbedding,
    clipEmbeddingVector: context.clipEmbeddingVector,
    detectedObjectCount: 0,
    scoring: context.scoring,
    sourceMetadata: sourceMetadataFromInput(input),
  };

  const photo = buildPhoto(input, metadata);
  photo.unifiedAnalysis = buildUnifiedAnalysis(photo);
  return {
    photo,
    cache: "skipped",
    clipEmbeddingVector: context.clipEmbeddingVector,
  };
}

function buildPhoto(
  input: ImagePipelineInput,
  metadata: CachedImageMetadata & { scoring: NonNullable<ImagePipelineContext["scoring"]> },
): Photo {
  return {
    id: input.id,
    fingerprint: input.fingerprint,
    lastModified: input.lastModified,
    url: input.url,
    originalFileUrl: input.originalFileUrl,
    previewFileUrl: input.previewFileUrl,
    previewUrl: input.previewUrl,
    name: input.name,
    width: input.width,
    height: input.height,
    analysis: metadata.analysis,
    imageQuality: metadata.imageQuality,
    sceneAnalysis: metadata.sceneAnalysis,
    detectedObjects: metadata.detectedObjects,
    faceAnalysis: metadata.faceAnalysis,
    aestheticScore: metadata.aestheticScore,
    clipEmbedding: metadata.clipEmbedding,
    unifiedAnalysis: metadata.unifiedAnalysis,
    sourceMetadata: {
      ...sourceMetadataFromInput(input),
      ...metadata.sourceMetadata,
    },
    group: 0,
    ...metadata.classification,
    ...metadata.scoring,
  };
}

function sourceMetadataFromInput(input: ImagePipelineInput) {
  return {
    originalFileUrl: input.originalFileUrl,
    previewFileUrl: input.previewFileUrl ?? input.previewUrl,
    storageBucket: input.storageBucket,
    originalStoragePath: input.originalStoragePath,
    previewStoragePath: input.previewStoragePath,
    fileName: input.fileName ?? input.name,
    uploadedAt: input.uploadedAt,
    originalMimeType: input.originalMimeType,
    mimeType: input.mimeType,
    convertedFromHeic: input.convertedFromHeic,
    conversionQuality: input.conversionQuality,
    conversionDecoder: input.conversionDecoder,
    originalByteSize: input.originalByteSize ?? input.byteSize,
    previewByteSize: input.previewByteSize,
  };
}

function fallbackSceneAnalysis(context: ImagePipelineContext): SceneAnalysis {
  const classification = context.classification;
  const analysis = context.analysis;
  const type = classification?.photoType ?? "random";
  const blueOrGreenDominant =
    !!analysis && (analysis.avgB > analysis.avgR || analysis.avgG > analysis.avgR);
  const outdoorsScore = type === "landscape" || blueOrGreenDominant ? 0.62 : 0.22;
  const food = type === "food" ? 0.7 : 0.08;
  const landscape = type === "landscape" ? 0.7 : 0.12;
  return {
    primaryScene: type === "random" ? "unknown" : type,
    secondaryScene: "local quick scan",
    indoorsOutdoors: outdoorsScore >= 0.55 ? "outdoors" : "unknown",
    confidenceScores: {
      primaryScene: classification?.photoTypeConfidence ?? 0.25,
      secondaryScene: 0.25,
      indoors: outdoorsScore >= 0.55 ? 0.18 : 0.4,
      outdoors: outdoorsScore,
      food,
      landscape,
      beach: 0,
      city: 0,
      mountains: 0,
      pets: 0,
      vehicles: 0,
      sports: 0,
    },
    labels: {
      food: food >= 0.5,
      landscape: landscape >= 0.5,
      beach: false,
      city: false,
      mountains: false,
      pets: false,
      vehicles: false,
      sports: false,
    },
    model: "local-quick-scan-v1",
  };
}

function fallbackDetectedObjects(context: ImagePipelineContext): DetectedObject[] {
  const classification = context.classification;
  if (!classification || classification.peopleCount <= 0) return [];
  return Array.from({ length: classification.peopleCount }).map((_, index) => ({
    label: "person",
    labelNormalized: "person",
    confidence: classification.peopleConfidence,
    model: `local-quick-scan-v1-${index}`,
  }));
}

function fallbackFaceAnalysis(context: ImagePipelineContext): FaceAnalysis {
  const analysis = context.analysis;
  const classification = context.classification;
  const count =
    analysis && analysis.detectedFaceCount >= 0
      ? Math.max(0, analysis.detectedFaceCount)
      : Math.max(0, classification?.peopleCount ?? 0);
  return {
    numberOfFaces: count,
    croppedFaces: 0,
    faces: [],
    model: "local-quick-scan-v1",
  };
}
