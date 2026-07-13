import type { Photo, PhotoRanking, Settings } from "../types";
import { withUnifiedAnalysis } from "./unified-analysis";

const MODEL = "metadata-ranking-engine";
const MODEL_VERSION = "metadata-ranking-v1";
const DEFAULT_MAX_KEEP = 20;
const MIN_CUT_RATE = 0.1;
const MAX_CUT_RATE = 0.3;
const TARGET_KEEP_RATE = 0.82;

export type RankingMetadataInput = {
  id: string;
  fingerprint?: string;
  name: string;
  width: number;
  height: number;
  orientation: Photo["orientation"];
  photoType: Photo["photoType"];
  peopleCount: Photo["peopleCount"];
  peopleConfidence: number;
  sceneAnalysis?: Photo["sceneAnalysis"];
  detectedObjects?: Photo["detectedObjects"];
  faceAnalysis?: Photo["faceAnalysis"];
  imageQuality?: Photo["imageQuality"];
  aestheticScore?: Photo["aestheticScore"];
  sourceMetadata?: Photo["sourceMetadata"];
  duplicateClusterId?: string;
  unifiedAnalysis?: Photo["unifiedAnalysis"];
  legacyScores: Photo["scores"];
};

export type RankedPhoto = Photo & {
  ranking: PhotoRanking;
};

export type RankingClusterSummary = {
  duplicateClusterId: string;
  bestPhotoId: string;
  photoIds: string[];
};

export type RankingResult = {
  photos: RankedPhoto[];
  decisions: PhotoRanking[];
  duplicateClusters: RankingClusterSummary[];
};

export function rankPhotos(
  photos: Photo[],
  options: { settings?: Settings; maxKeep?: number } = {},
): RankingResult {
  const originalById = new Map(photos.map((photo) => [photo.id, photo]));
  const inputs = photos.map(toRankingMetadata);
  const baseScores = inputs.map((input) => ({
    input,
    baseScore: baseKeepScore(input, options.settings),
    signals: rankingSignals(input, options.settings),
  }));

  const clusters = groupByCluster(baseScores);
  const clusterRanks = new Map<string, Map<string, number>>();
  const clusterBest = new Map<string, string>();

  for (const [clusterId, entries] of clusters) {
    const sorted = [...entries].sort((a, b) => b.baseScore - a.baseScore);
    clusterBest.set(clusterId, sorted[0]?.input.id ?? entries[0].input.id);
    const ranks = new Map<string, number>();
    sorted.forEach((entry, index) => ranks.set(entry.input.id, index + 1));
    clusterRanks.set(clusterId, ranks);
  }

  const withDuplicateScores = baseScores.map((entry) => {
    const clusterId = entry.input.duplicateClusterId ?? `singleton:${entry.input.id}`;
    const rank = clusterRanks.get(clusterId)?.get(entry.input.id) ?? 1;
    const size = clusters.get(clusterId)?.length ?? 1;
    const duplicatePenalty = size > 1 && rank > 1 ? Math.min(0.38, 0.16 + rank * 0.06) : 0;
    const overallScore = clamp(entry.baseScore - duplicatePenalty);
    return {
      ...entry,
      clusterId,
      duplicateClusterRank: rank,
      bestPhotoId: clusterBest.get(clusterId) ?? entry.input.id,
      overallScore,
      signals: {
        ...entry.signals,
        duplicatePenalty,
      },
    };
  });

  const sorted = [...withDuplicateScores].sort((a, b) => b.overallScore - a.overallScore);
  const rankById = new Map(sorted.map((entry, index) => [entry.input.id, index + 1]));
  const maxKeep = options.maxKeep ?? DEFAULT_MAX_KEEP;

  const ranked = withDuplicateScores.map((entry) => {
    const overallRank = rankById.get(entry.input.id) ?? photos.length;
    const keepScore = clamp(entry.overallScore);
    const deleteScore = clamp(1 - keepScore);
    const confidence = confidenceScore(entry.input, entry.duplicateClusterRank, keepScore);
    const recommendation = overallRank <= maxKeep && keepScore >= 0.5 ? "keep" : "delete";
    const ranking: PhotoRanking = {
      keepScore,
      deleteScore,
      confidence,
      explanation: explanation(entry.input, entry.signals, entry.duplicateClusterRank),
      recommendation,
      bestInDuplicateCluster: entry.bestPhotoId === entry.input.id,
      duplicateClusterBestPhotoId: entry.bestPhotoId,
      duplicateClusterRank: entry.duplicateClusterRank,
      overallRank,
      overallScore: keepScore,
      model: MODEL,
      modelVersion: MODEL_VERSION,
      signals: entry.signals,
      scoreBreakdown: {
        technical: entry.signals.technical,
        aesthetic: entry.signals.aesthetic,
        people: entry.signals.face,
        sceneTagMatch: entry.signals.scene,
        objectTagMatch: entry.signals.object,
        final: keepScore,
        tagBoost: entry.signals.tagMatch * 0.21,
        selectedTags: options.settings?.vibes ?? [],
      },
    };

    const original = originalById.get(entry.input.id)!;
    return withUnifiedAnalysis(
      {
        ...original,
        duplicateClusterId: entry.input.duplicateClusterId,
        ranking,
        kept: recommendation === "keep",
        overall: keepScore,
        reasons: [ranking.explanation],
      },
      { ranking, duplicateClusterId: entry.input.duplicateClusterId },
    ) satisfies RankedPhoto;
  });

  ranked.sort((a, b) => a.ranking.overallRank - b.ranking.overallRank);

  return {
    photos: ranked,
    decisions: ranked.map((photo) => photo.ranking),
    duplicateClusters: [...clusters.entries()]
      .filter(([, entries]) => entries.length > 1)
      .map(([duplicateClusterId, entries]) => ({
        duplicateClusterId,
        bestPhotoId: clusterBest.get(duplicateClusterId) ?? entries[0].input.id,
        photoIds: entries.map((entry) => entry.input.id),
      })),
  };
}

export function rankingShortlist(
  photos: Photo[],
  _maxKeep = DEFAULT_MAX_KEEP,
  options: { allowMultipleClusterIds?: Set<string> } = {},
): RankedPhoto[] {
  const ranked = photos
    .filter(hasRanking)
    .sort((a, b) => a.ranking.overallRank - b.ranking.overallRank);
  const cutIds = balancedCutIds(ranked, options);

  const selected = ranked.filter((photo) => !cutIds.has(photo.id));

  return selected.length ? selected : ranked.slice(0, Math.min(photos.length, DEFAULT_MAX_KEEP));
}

function balancedCutIds(
  ranked: RankedPhoto[],
  options: { allowMultipleClusterIds?: Set<string> } = {},
) {
  const cutIds = new Set<string>();
  if (!ranked.length) return cutIds;

  for (const photo of ranked) {
    const cluster = photo.duplicateClusterId;
    const exactDuplicate =
      photo.duplicateRelationship?.relationship === "Exact Duplicate" &&
      photo.ranking.bestInDuplicateCluster === false;
    if (exactDuplicate && cluster && !options.allowMultipleClusterIds?.has(cluster)) {
      cutIds.add(photo.id);
      continue;
    }
    if (isObviousAutoCut(photo)) cutIds.add(photo.id);
  }

  if (ranked.length < 8) return cutIds;

  const maxCuts = Math.ceil(ranked.length * MAX_CUT_RATE);
  const targetCuts = clampNumber(
    Math.round(ranked.length * (1 - TARGET_KEEP_RATE)),
    Math.floor(ranked.length * MIN_CUT_RATE),
    maxCuts,
  );
  const weakCandidates = ranked
    .filter((photo) => !cutIds.has(photo.id))
    .map((photo) => ({ photo, score: finalSelectionScore(photo, ranked) }))
    .filter(({ photo, score }) => score < weakCutThreshold(photo))
    .sort((a, b) => a.score - b.score);

  const additionalNeeded = Math.min(maxCuts - cutIds.size, targetCuts - cutIds.size);
  if (additionalNeeded > 0) {
    weakCandidates.slice(0, additionalNeeded).forEach(({ photo }) => cutIds.add(photo.id));
  }

  console.debug("[dumpdeck] balanced selection", {
    total: ranked.length,
    targetKeepRate: TARGET_KEEP_RATE,
    minCutRate: MIN_CUT_RATE,
    maxCutRate: MAX_CUT_RATE,
    targetCuts,
    actualCuts: cutIds.size,
    cutIds: [...cutIds],
    weakCandidates: weakCandidates.map(({ photo, score }) => ({
      id: photo.id,
      name: photo.name,
      score,
      reason: removedReason(
        photo,
        ranked.filter((candidate) => candidate.id !== photo.id),
      ),
      breakdown: photo.ranking?.scoreBreakdown,
    })),
  });

  return cutIds;
}

export function removedByRanking(photos: Photo[], kept: Photo[]) {
  const keptIds = new Set(kept.map((photo) => photo.id));
  return photos
    .filter((photo) => !keptIds.has(photo.id))
    .map((photo) => ({
      photo,
      reason: removedReason(photo, kept),
      source: "ai" as const,
      similarToId:
        photo.ranking?.bestInDuplicateCluster === false
          ? photo.ranking.duplicateClusterBestPhotoId
          : undefined,
    }));
}

function removedReason(photo: Photo, kept: Photo[]) {
  const ranking = photo.ranking;
  if (!ranking) return "Cut because technical quality was much lower than the rest.";
  const similar = ranking.duplicateClusterBestPhotoId
    ? kept.find((candidate) => candidate.id === ranking.duplicateClusterBestPhotoId)
    : undefined;
  if (
    photo.duplicateRelationship?.relationship === "Exact Duplicate" &&
    !ranking.bestInDuplicateCluster
  ) {
    return similar
      ? `Cut because this was an exact duplicate of "${similar.name}".`
      : "Cut because this was an exact duplicate.";
  }
  if (!ranking.bestInDuplicateCluster && similar && isClearlyWorseThan(photo, similar)) {
    const photoQuality = photo.imageQuality?.overallTechnicalQuality ?? photo.scores.quality;
    const keptQuality = similar.imageQuality?.overallTechnicalQuality ?? similar.scores.quality;
    const reason =
      keptQuality > photoQuality + 0.04
        ? "higher technical quality"
        : "a clearer version of the same moment";
    return `Cut because a stronger duplicate was kept. "${similar.name}" had ${reason}.`;
  }
  const breakdown = ranking.scoreBreakdown;
  const sharpness = photo.imageQuality?.sharpness ?? photo.analysis.sharpness;
  const brightness = photo.imageQuality?.signals.brightness ?? photo.analysis.brightness;
  if (looksLikeScreenshot(photo)) {
    if (isTextHeavy(photo)) {
      return "Cut because it looks like a text-heavy screenshot, not a camera-roll photo.";
    }
    return "Cut because it looks like a screenshot or app screen.";
  }
  if (isJunkNonPhoto(photo)) {
    return "Cut because it was text-heavy and did not match the selected photo-dump vibe.";
  }
  if (sharpness < blurCutoff(photo)) return "Cut because this photo was very blurry.";
  if (brightness < 0.08) return "Cut because this photo was too dark to use.";
  if (brightness > 0.94) return "Cut because this photo was overexposed.";
  const strongerEventPhoto = strongerSameEventPhoto(photo, kept);
  if (strongerEventPhoto && isClearlyWorseThan(photo, strongerEventPhoto)) {
    const photoQuality = photo.imageQuality?.overallTechnicalQuality ?? photo.scores.quality;
    const keptQuality =
      strongerEventPhoto.imageQuality?.overallTechnicalQuality ?? strongerEventPhoto.scores.quality;
    if (
      (strongerEventPhoto.imageQuality?.sharpness ?? strongerEventPhoto.analysis.sharpness) >
      sharpness + 0.16
    ) {
      return `Cut because a sharper photo from the same moment was kept: "${strongerEventPhoto.name}".`;
    }
    if (keptQuality > photoQuality + 0.12) {
      return `Cut because the lighting or technical quality was weaker than "${strongerEventPhoto.name}".`;
    }
    return `Cut because a stronger photo from the same event was kept: "${strongerEventPhoto.name}".`;
  }
  if (breakdown?.technical !== undefined && breakdown.technical < 0.24) {
    return "Cut because technical quality was much lower than the rest.";
  }
  if (breakdown?.aesthetic !== undefined && breakdown.aesthetic < 0.34) {
    return "Cut because the aesthetic score was much lower than the rest.";
  }
  if (breakdown?.sceneTagMatch !== undefined && breakdown.sceneTagMatch < 0.32) {
    return "Cut because it was less relevant to the selected vibe.";
  }
  if (hasClosedEyes(photo)) {
    return "Cut because eyes were closed or face visibility was low.";
  }
  return "Cut because composition and technical signals were weaker than the rest of the batch.";
}

function hasClosedEyes(photo: Photo) {
  return (photo.faceAnalysis?.faces ?? []).some(
    (face) => !face.eyesOpen.both && face.eyesOpen.confidence >= 0.62,
  );
}

function isObviousAutoCut(photo: Photo) {
  if (photo.duplicateRelationship?.relationship === "Exact Duplicate") {
    return photo.ranking?.bestInDuplicateCluster === false;
  }
  if (looksLikeScreenshot(photo)) return true;
  if (isJunkNonPhoto(photo)) return true;
  const sharpness = photo.imageQuality?.sharpness ?? photo.analysis.sharpness;
  const brightness = photo.imageQuality?.signals.brightness ?? photo.analysis.brightness;
  const technical = photo.imageQuality?.overallTechnicalQuality ?? photo.scores.quality;
  if (sharpness < blurCutoff(photo)) return true;
  if (brightness < 0.08 || brightness > 0.94) return true;
  return technical < 0.18 && sharpness < 0.22;
}

function finalSelectionScore(photo: Photo, batch: Photo[]) {
  const breakdown = photo.ranking?.scoreBreakdown;
  const sharpness = photo.imageQuality?.sharpness ?? photo.analysis.sharpness;
  const brightness = photo.imageQuality?.signals.brightness ?? photo.analysis.brightness;
  const technical =
    breakdown?.technical ?? photo.imageQuality?.overallTechnicalQuality ?? photo.scores.quality;
  const aesthetic =
    breakdown?.aesthetic ??
    (photo.aestheticScore?.modelAvailable
      ? photo.aestheticScore.score / 10
      : photo.scores.aesthetic);
  const tagMatch =
    breakdown?.sceneTagMatch ?? photo.ranking?.signals?.tagMatch ?? photo.scores.postWorthy;
  const face = breakdown?.people ?? photo.ranking?.signals?.face ?? 0.65;
  const sameEventRank = sameEventRankPenalty(photo, batch);
  const duplicatePenalty =
    photo.duplicateRelationship?.relationship === "Near Duplicate" &&
    photo.ranking?.bestInDuplicateCluster === false
      ? 0.08
      : 0;
  const junkPenalty = looksLikeScreenshot(photo) ? 0.45 : isJunkNonPhoto(photo) ? 0.32 : 0;
  const lightingPenalty = brightness < 0.16 || brightness > 0.88 ? 0.12 : 0;
  const heicGrace = photo.sourceMetadata?.convertedFromHeic ? 0.04 : 0;

  return clampNumber(
    technical * 0.26 +
      aesthetic * 0.24 +
      sharpness * 0.16 +
      tagMatch * 0.14 +
      face * 0.06 +
      (photo.ranking?.overallScore ?? photo.overall) * 0.14 +
      heicGrace -
      junkPenalty -
      lightingPenalty -
      duplicatePenalty -
      sameEventRank,
    0,
    1,
  );
}

function weakCutThreshold(photo: Photo) {
  if (looksLikeScreenshot(photo)) return 0.9;
  if (isJunkNonPhoto(photo)) return 0.82;
  if (photo.sourceMetadata?.convertedFromHeic) return 0.48;
  if (photo.duplicateRelationship?.relationship === "Near Duplicate") return 0.62;
  if (photo.eventGroup?.photoCount && photo.eventGroup.photoCount > 2) return 0.58;
  return 0.54;
}

function sameEventRankPenalty(photo: Photo, batch: Photo[]) {
  if (!photo.eventGroup?.groupId) return 0;
  const peers = batch
    .filter(
      (candidate) =>
        candidate.id !== photo.id && candidate.eventGroup?.groupId === photo.eventGroup?.groupId,
    )
    .sort(
      (a, b) => (b.ranking?.overallScore ?? b.overall) - (a.ranking?.overallScore ?? a.overall),
    );
  if (!peers.length) return 0;
  const best = peers[0];
  return isClearlyWorseThan(photo, best) ? 0.08 : 0.02;
}

function isClearlyWorseThan(photo: Photo, similar: Photo) {
  const photoQuality = photo.imageQuality?.overallTechnicalQuality ?? photo.scores.quality;
  const keptQuality = similar.imageQuality?.overallTechnicalQuality ?? similar.scores.quality;
  const photoSharpness = photo.imageQuality?.sharpness ?? photo.analysis.sharpness;
  const keptSharpness = similar.imageQuality?.sharpness ?? similar.analysis.sharpness;
  return keptQuality > photoQuality + 0.18 || keptSharpness > photoSharpness + 0.22;
}

function strongerSameEventPhoto(photo: Photo, kept: Photo[]) {
  if (!photo.eventGroup?.groupId) return undefined;
  return kept
    .filter((candidate) => candidate.eventGroup?.groupId === photo.eventGroup?.groupId)
    .sort(
      (a, b) => (b.ranking?.overallScore ?? b.overall) - (a.ranking?.overallScore ?? a.overall),
    )[0];
}

function blurCutoff(photo: Photo) {
  return photo.sourceMetadata?.convertedFromHeic ? 0.1 : 0.13;
}

function looksLikeScreenshot(photo: Photo) {
  const name = photo.name.toLowerCase();
  const type = photo.photoType.toLowerCase();
  const scene = photo.sceneAnalysis?.primaryScene.toLowerCase() ?? "";
  const objects = new Set((photo.detectedObjects ?? []).map((object) => object.labelNormalized));
  const ratio = photo.width / Math.max(1, photo.height);
  const commonScreenRatio =
    Math.abs(ratio - 9 / 16) < 0.025 ||
    Math.abs(ratio - 16 / 9) < 0.025 ||
    Math.abs(ratio - 19.5 / 9) < 0.035;
  const uiObjects = hasAny(objects, ["screen", "button", "keyboard", "computer", "laptop"]);
  return (
    /\bscreen\s?shot\b|screenshot|screen_recording|screen-recording/.test(name) ||
    type.includes("screenshot") ||
    scene.includes("screenshot") ||
    scene.includes("screen") ||
    scene.includes("webpage") ||
    scene.includes("app") ||
    uiObjects ||
    (commonScreenRatio && isTextHeavy(photo) && photo.analysis.sharpness > 0.48)
  );
}

function isTextHeavy(photo: Photo) {
  const scene = photo.sceneAnalysis?.primaryScene.toLowerCase() ?? "";
  const objects = new Set((photo.detectedObjects ?? []).map((object) => object.labelNormalized));
  const textObjects = (photo.detectedObjects ?? []).filter((object) =>
    ["text", "document", "receipt", "menu", "sign", "poster"].includes(object.labelNormalized),
  );
  return (
    scene.includes("receipt") ||
    scene.includes("document") ||
    scene.includes("meme") ||
    textObjects.length >= 2 ||
    (objects.has("text") && objects.has("screen"))
  );
}

function isJunkNonPhoto(photo: Photo) {
  const scene = photo.sceneAnalysis?.primaryScene.toLowerCase() ?? "";
  const objects = new Set((photo.detectedObjects ?? []).map((object) => object.labelNormalized));
  return (
    isTextHeavy(photo) ||
    scene.includes("meme") ||
    scene.includes("receipt") ||
    scene.includes("document") ||
    hasAny(objects, ["receipt", "document", "webpage"])
  );
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toRankingMetadata(photo: Photo): RankingMetadataInput {
  const unified = photo.unifiedAnalysis?.analysis;
  return {
    id: photo.id,
    fingerprint: photo.fingerprint,
    name: photo.name,
    width: photo.width,
    height: photo.height,
    orientation: unified?.orientation ?? photo.orientation,
    photoType: photo.photoType,
    peopleCount: Math.min(4, unified?.peopleCount ?? photo.peopleCount) as Photo["peopleCount"],
    peopleConfidence: unified?.confidence ?? photo.peopleConfidence,
    sceneAnalysis: photo.sceneAnalysis,
    detectedObjects: photo.detectedObjects,
    faceAnalysis: photo.faceAnalysis,
    imageQuality: photo.imageQuality,
    aestheticScore: photo.aestheticScore,
    sourceMetadata: photo.sourceMetadata,
    duplicateClusterId: unified?.duplicateCluster || photo.duplicateClusterId,
    unifiedAnalysis: photo.unifiedAnalysis,
    legacyScores: photo.scores,
  };
}

function baseKeepScore(input: RankingMetadataInput, settings: Settings | undefined) {
  const signals = rankingSignals(input, settings);
  const raw =
    signals.technical * 0.23 +
    signals.aesthetic * 0.26 +
    signals.face * 0.07 +
    signals.scene * 0.17 +
    signals.object * 0.13 +
    signals.tagMatch * 0.14;
  return clamp(
    calibrateScore(raw) +
      (settings?.vibes.includes("random") ? signals.diversity * 0.08 : 0) +
      signals.tagMatch * 0.08,
  );
}

function rankingSignals(input: RankingMetadataInput, settings: Settings | undefined) {
  const unified = input.unifiedAnalysis?.analysis;
  const rawTechnical =
    unified?.technicalQuality.overall ??
    input.imageQuality?.overallTechnicalQuality ??
    input.legacyScores.quality;
  const technical = input.sourceMetadata?.convertedFromHeic
    ? Math.max(rawTechnical, clamp(rawTechnical + 0.08, 0, 0.78))
    : rawTechnical;
  const aesthetic = input.aestheticScore?.modelAvailable
    ? (unified?.aestheticScore ?? input.aestheticScore.score) / 10
    : input.legacyScores.aesthetic;

  const face = faceSignal(input);
  const scene = sceneSignal(input, settings);
  const object = objectSignal(input, settings);
  const tagMatch = tagMatchSignal(input, settings);
  const diversity = diversitySignal(input);

  return {
    technical: clamp(technical),
    aesthetic: clamp(aesthetic),
    face: clamp(face),
    scene: clamp(scene),
    object: clamp(object),
    tagMatch: clamp(tagMatch),
    diversity: clamp(diversity),
    duplicatePenalty: 0,
  };
}

function faceSignal(input: RankingMetadataInput) {
  if (!input.faceAnalysis || input.faceAnalysis.numberOfFaces === 0) {
    return input.peopleCount > 0 ? 0.5 : 0.68;
  }

  const faces = input.faceAnalysis.faces;
  if (!faces.length) return 0.55;

  const visible = average(
    faces.map((face) => {
      const visibility =
        face.faceVisibility.value === "clear"
          ? 1
          : face.faceVisibility.value === "partial" || face.faceVisibility.value === "profile"
            ? 0.58
            : 0.25;
      const smile = face.smiling.value ? face.smiling.confidence : 0.45;
      const eyes = face.eyesOpen.both ? face.eyesOpen.confidence : 0.25;
      const cropPenalty = face.cropped.value ? 0.22 : 0;
      return clamp(visibility * 0.42 + smile * 0.28 + eyes * 0.3 - cropPenalty);
    }),
  );

  const groupBoost = input.faceAnalysis.numberOfFaces > 1 ? 0.04 : 0;
  return clamp(visible + groupBoost);
}

function sceneSignal(input: RankingMetadataInput, settings: Settings | undefined) {
  const scene = input.sceneAnalysis;
  if (!scene) return input.legacyScores.postWorthy;

  const labels = scene.labels;
  const vibes = settings?.vibes ?? [];
  let score =
    scene.confidenceScores.primaryScene * 0.34 + input.legacyScores.postWorthy * 0.38 + 0.2;

  if (labels.food && vibes.includes("food")) score += 0.18;
  if (
    (labels.landscape || labels.beach || labels.mountains || labels.city) &&
    vibes.includes("vacation")
  ) {
    score += 0.14;
  }
  if (input.peopleCount > 0 && (vibes.includes("friends") || vibes.includes("cute"))) score += 0.12;
  if (labels.sports || labels.pets || labels.vehicles) score += 0.04;
  if (vibes.includes("aesthetic")) score += input.imageQuality?.contrast ? 0.04 : 0;
  if (
    input.peopleCount === 0 &&
    (labels.landscape || labels.beach || labels.city || labels.mountains || labels.food)
  ) {
    score += 0.08;
  }
  if (
    input.photoType === "detail" ||
    input.photoType === "food" ||
    input.photoType === "landscape"
  ) {
    score += 0.08;
  }

  return clamp(score);
}

function objectSignal(input: RankingMetadataInput, settings: Settings | undefined) {
  const objects = input.detectedObjects ?? [];
  if (!objects.length) {
    const typeBoost =
      input.photoType === "detail" || input.photoType === "food" || input.photoType === "landscape"
        ? 0.12
        : 0;
    return clamp(input.legacyScores.unique + typeBoost);
  }

  const bestObject = Math.max(...objects.map((object) => object.confidence));
  const labels = new Set(objects.map((object) => object.labelNormalized));
  let score = 0.38 + bestObject * 0.36 + Math.min(0.18, labels.size * 0.03);

  if (settings?.vibes.includes("food") && hasAny(labels, ["food", "pizza", "cake", "sandwich"])) {
    score += 0.12;
  }
  if (settings?.vibes.includes("friends") && hasAny(labels, ["person"])) {
    score += 0.08;
  }
  if (hasAny(labels, ["dog", "cat"])) score += 0.08;
  if (hasAny(labels, ["building", "architecture", "flower", "plant", "drink", "cup", "plate"])) {
    score += 0.08;
  }

  return clamp(score);
}

function tagMatchSignal(input: RankingMetadataInput, settings: Settings | undefined) {
  const vibes = settings?.vibes?.length ? settings.vibes : (["random"] as Settings["vibes"]);
  if (vibes.includes("random")) return diversitySignal(input);

  const labels = input.sceneAnalysis?.labels;
  const objectLabels = new Set(
    (input.detectedObjects ?? []).map((object) => object.labelNormalized),
  );
  let score = 0.28;

  if (vibes.includes("vacation")) {
    if (labels?.landscape || labels?.beach || labels?.mountains || labels?.city) score += 0.32;
    if (input.sceneAnalysis?.indoorsOutdoors === "outdoors") score += 0.12;
    if (input.photoType === "landscape") score += 0.12;
    if (hasAny(objectLabels, ["building", "boat", "car", "airplane", "train"])) score += 0.08;
  }
  if (vibes.includes("aesthetic")) {
    score += clamp((input.imageQuality?.contrast ?? input.legacyScores.lighting) * 0.14);
    score += clamp((input.imageQuality?.saturation ?? input.legacyScores.aesthetic) * 0.12);
    if (input.legacyScores.quality >= 0.62) score += 0.1;
    if (
      input.photoType === "detail" ||
      input.photoType === "landscape" ||
      input.photoType === "food"
    ) {
      score += 0.14;
    }
    if (input.peopleCount === 0) score += 0.04;
  }
  if (vibes.includes("friends") || vibes.includes("cute")) {
    if (input.peopleCount > 0) score += 0.24;
    if (input.faceAnalysis && input.faceAnalysis.numberOfFaces > 1) score += 0.12;
    if ((input.faceAnalysis?.faces ?? []).some((face) => face.smiling.value)) score += 0.1;
  }
  if (vibes.includes("food")) {
    if (labels?.food || input.photoType === "food") score += 0.28;
    if (hasAny(objectLabels, ["food", "pizza", "cake", "sandwich", "plate", "bowl", "cup"]))
      score += 0.18;
  }
  if (vibes.includes("funny")) {
    if (input.peopleCount > 0) score += 0.12;
    score += input.legacyScores.fun * 0.18;
  }

  return clamp(score);
}

function diversitySignal(input: RankingMetadataInput) {
  const scene = input.sceneAnalysis;
  const objectCount = new Set((input.detectedObjects ?? []).map((object) => object.labelNormalized))
    .size;
  let score = 0.42 + Math.min(0.18, objectCount * 0.035);
  if (scene) {
    const activeLabels = Object.values(scene.labels).filter(Boolean).length;
    score += Math.min(0.18, activeLabels * 0.04);
    if (scene.primaryScene !== "unknown") score += 0.08;
  }
  if (input.photoType !== "random") score += 0.08;
  if (input.peopleCount > 0) score += 0.04;
  return clamp(score);
}

function confidenceScore(
  input: RankingMetadataInput,
  duplicateClusterRank: number,
  keepScore: number,
) {
  const metadataCoverage = average([
    input.imageQuality ? 1 : 0,
    input.aestheticScore?.modelAvailable ? input.aestheticScore.confidence : 0.25,
    input.sceneAnalysis ? input.sceneAnalysis.confidenceScores.primaryScene : 0,
    input.detectedObjects ? 0.8 : 0,
    input.faceAnalysis ? 0.8 : 0,
  ]);
  const decisiveness = Math.abs(keepScore - 0.5) * 1.5;
  const duplicateClarity = duplicateClusterRank === 1 ? 0.08 : 0;
  return clamp(metadataCoverage * 0.68 + decisiveness * 0.24 + duplicateClarity);
}

function explanation(
  input: RankingMetadataInput,
  signals: PhotoRanking["signals"],
  duplicateClusterRank: number,
) {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (signals.technical >= 0.72) strengths.push("strong technical quality");
  if (signals.aesthetic >= 0.72) strengths.push("high aesthetic score");
  if (signals.face >= 0.72) strengths.push("clear face signals");
  if (signals.scene >= 0.72) strengths.push("strong scene match");
  if (signals.object >= 0.72) strengths.push("distinct objects");
  if (signals.tagMatch >= 0.72) strengths.push("strong match for selected tags");

  if (signals.technical < 0.45) weaknesses.push("technical quality is low");
  if (signals.aesthetic < 0.45) weaknesses.push("aesthetic score is low");
  if (signals.face < 0.45 && input.peopleCount > 0) weaknesses.push("faces are less usable");
  if (signals.tagMatch < 0.42) weaknesses.push("weak match for selected tags");
  if (duplicateClusterRank > 1) {
    weaknesses.push("near-duplicate with lower sharpness, face visibility, or tag match");
  }

  if (strengths.length && !weaknesses.length) return `Keep: ${joinReasons(strengths)}.`;
  if (strengths.length && weaknesses.length) {
    return `Mixed: ${joinReasons(strengths)}, but ${joinReasons(weaknesses)}.`;
  }
  if (weaknesses.length) return `Delete: ${joinReasons(weaknesses)}.`;
  return "Keep/delete decision based on balanced extracted metadata signals.";
}

function calibrateScore(raw: number) {
  if (raw < 0.28) return raw * 0.95;
  if (raw < 0.5) return 0.27 + (raw - 0.28) * 1.25;
  if (raw < 0.72) return 0.55 + (raw - 0.5) * 1.2;
  return 0.81 + (raw - 0.72) * 0.68;
}

function groupByCluster<T extends { input: RankingMetadataInput }>(entries: T[]) {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const clusterId = entry.input.duplicateClusterId ?? `singleton:${entry.input.id}`;
    groups.set(clusterId, [...(groups.get(clusterId) ?? []), entry]);
  }
  return groups;
}

function hasRanking(photo: Photo): photo is RankedPhoto {
  return !!photo.ranking;
}

function hasAny(labels: Set<string>, values: string[]) {
  return values.some((value) => labels.has(value));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function joinReasons(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function clamp(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
