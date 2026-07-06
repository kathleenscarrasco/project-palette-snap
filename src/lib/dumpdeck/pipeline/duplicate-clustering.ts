import type { Photo } from "../types";
import { withUnifiedAnalysis } from "./unified-analysis";

export type DuplicateSensitivity = "strict" | "balanced" | "aggressive";

const DUPLICATE_COSINE_THRESHOLD = 0.96;
const NEAR_DUPLICATE_SCORE_THRESHOLD: Record<DuplicateSensitivity, number> = {
  strict: 0.94,
  balanced: 0.91,
  aggressive: 0.87,
};

export type DuplicateClusterInput = {
  photo: Photo;
  clipEmbeddingVector?: number[];
};

export type DuplicateCluster = {
  id: string;
  photos: Photo[];
  averageSimilarity: number;
  reason: string;
  confidence: number;
};

export type DuplicateSimilarGroup = {
  id: number;
  photos: Photo[];
  kind: "exact" | "near-dup";
  reason: string;
  confidence: number;
  suggestedBestPhotoId: string;
};

export function assignDuplicateClusters(
  items: DuplicateClusterInput[],
  threshold = DUPLICATE_COSINE_THRESHOLD,
  sensitivity: DuplicateSensitivity = "balanced",
): {
  photos: Photo[];
  clusters: DuplicateCluster[];
} {
  const parent = items.map((_, index) => index);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].clipEmbeddingVector;
      const b = items[j].clipEmbeddingVector;
      const metadata = duplicateConfidence(items[i].photo, items[j].photo);
      const embeddingSimilarity = a && b && a.length === b.length ? cosineSimilarity(a, b) : 0;
      const visuallyNearIdentical =
        metadata.pixel >= 0.9 && metadata.composition >= 0.88 && metadata.crop >= 0.92;
      if (
        isExactDuplicate(items[i].photo, items[j].photo) ||
        (visuallyNearIdentical &&
          embeddingSimilarity >= threshold &&
          metadata.score >= NEAR_DUPLICATE_SCORE_THRESHOLD.strict) ||
        (visuallyNearIdentical && metadata.score >= NEAR_DUPLICATE_SCORE_THRESHOLD[sensitivity])
      ) {
        union(parent, i, j);
      }
    }
  }

  const grouped = new Map<number, DuplicateClusterInput[]>();
  items.forEach((item, index) => {
    const root = find(parent, index);
    grouped.set(root, [...(grouped.get(root) ?? []), item]);
  });

  const clusterMap = new Map<string, DuplicateCluster>();
  const photos = items.map((item) => {
    const root = find(parent, items.indexOf(item));
    const group = grouped.get(root) ?? [item];
    const id = duplicateClusterId(group);
    const confidence = groupConfidence(group.map((entry) => entry.photo));
    const bestPhoto = bestDuplicatePhoto(group.map((entry) => entry.photo));
    const photo = withUnifiedAnalysis(
      {
        ...item.photo,
        duplicateClusterId: id,
        duplicateRelationship: {
          groupId: group.length > 1 ? id : "",
          relationship:
            group.length > 1
              ? group.every((entry) => isExactDuplicate(group[0].photo, entry.photo))
                ? "Exact Duplicate"
                : "Near Duplicate"
              : "",
          confidence: group.length > 1 ? confidence : 0,
          bestPhoto: bestPhoto?.id === item.photo.id,
          reason: group.length > 1 ? duplicateReason(group.map((entry) => entry.photo)) : "",
        },
      },
      { duplicateClusterId: id },
    );

    if (!clusterMap.has(id)) {
      clusterMap.set(id, {
        id,
        photos: [],
        averageSimilarity: averageSimilarity(group),
        reason: duplicateReason(group.map((entry) => entry.photo)),
        confidence,
      });
    }
    clusterMap.get(id)!.photos.push(photo);
    return photo;
  });

  return {
    photos,
    clusters: Array.from(clusterMap.values()),
  };
}

export function buildDuplicateGroupsForPhotos(photos: Photo[]): DuplicateSimilarGroup[] {
  const groups = new Map<string, Photo[]>();
  photos.forEach((photo) => {
    const id = photo.duplicateClusterId ?? `dup_${photo.fingerprint ?? photo.id}`;
    groups.set(id, [...(groups.get(id) ?? []), photo]);
  });

  return Array.from(groups.values()).map((group, index) => {
    const sorted = [...group].sort((a, b) => b.overall - a.overall);
    return {
      id: index,
      kind: group.every((photo) => isExactDuplicate(group[0], photo)) ? "exact" : "near-dup",
      photos: sorted,
      reason: duplicateReason(sorted),
      confidence: groupConfidence(sorted),
      suggestedBestPhotoId: sorted[0]?.id ?? "",
    };
  });
}

function duplicateClusterId(items: DuplicateClusterInput[]) {
  const key = items.map((item) => item.photo.fingerprint ?? item.photo.id).sort()[0];
  return `dup_${key.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function averageSimilarity(items: DuplicateClusterInput[]) {
  const values: number[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].clipEmbeddingVector;
      const b = items[j].clipEmbeddingVector;
      if (a && b && a.length === b.length) values.push(cosineSimilarity(a, b));
      else values.push(duplicateConfidence(items[i].photo, items[j].photo).score);
    }
  }
  if (!values.length) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isExactDuplicate(a: Photo, b: Photo) {
  if (a.id === b.id) return true;
  if (a.fingerprint && b.fingerprint && a.fingerprint === b.fingerprint) return true;
  return (
    !!a.analysis.aHash &&
    a.analysis.aHash === b.analysis.aHash &&
    a.analysis.dHash === b.analysis.dHash
  );
}

function duplicateConfidence(a: Photo, b: Photo) {
  const scene = sceneSimilarity(a, b);
  const objects = objectOverlap(a, b);
  const people = peopleSimilarity(a, b);
  const aspect = aspectSimilarity(a, b);
  const pixel = pixelSimilarity(a, b);
  const crop = cropSimilarity(a, b);
  const composition = compositionSimilarity(a, b);
  const sameVisualFrame = pixel >= 0.9 && composition >= 0.88 && aspect >= 0.92;
  const supporting = scene * 0.1 + objects * 0.08 + people * 0.09 + crop * 0.12;
  const score = sameVisualFrame
    ? pixel * 0.42 + composition * 0.26 + aspect * 0.13 + supporting
    : pixel * 0.35 + composition * 0.2 + supporting * 0.45;
  return { score: clamp(score), scene, objects, people, aspect, pixel, crop, composition };
}

function sceneSimilarity(a: Photo, b: Photo) {
  const aScene = a.sceneAnalysis;
  const bScene = b.sceneAnalysis;
  if (!aScene || !bScene) return a.photoType === b.photoType ? 0.55 : 0.15;
  let score = 0;
  if (aScene.primaryScene === bScene.primaryScene) score += 0.5;
  if (aScene.secondaryScene === bScene.secondaryScene) score += 0.18;
  if (aScene.indoorsOutdoors === bScene.indoorsOutdoors) score += 0.12;
  const labelKeys = Object.keys(aScene.labels) as (keyof typeof aScene.labels)[];
  const shared = labelKeys.filter((key) => aScene.labels[key] && bScene.labels[key]).length;
  const active = labelKeys.filter((key) => aScene.labels[key] || bScene.labels[key]).length;
  return clamp(score + (active ? (shared / active) * 0.2 : 0));
}

function objectOverlap(a: Photo, b: Photo) {
  const aObjects = new Set((a.detectedObjects ?? []).map((object) => object.labelNormalized));
  const bObjects = new Set((b.detectedObjects ?? []).map((object) => object.labelNormalized));
  if (!aObjects.size && !bObjects.size) return 0.35;
  const shared = [...aObjects].filter((label) => bObjects.has(label)).length;
  const total = new Set([...aObjects, ...bObjects]).size || 1;
  return shared / total;
}

function peopleSimilarity(a: Photo, b: Photo) {
  const aPeople = a.faceAnalysis?.numberOfFaces ?? a.peopleCount;
  const bPeople = b.faceAnalysis?.numberOfFaces ?? b.peopleCount;
  if (aPeople === 0 && bPeople === 0) return 0.75;
  const count = 1 - Math.min(1, Math.abs(aPeople - bPeople) / 4);
  const bothPeople = aPeople > 0 && bPeople > 0 ? 0.25 : 0;
  return clamp(count * 0.75 + bothPeople);
}

function aspectSimilarity(a: Photo, b: Photo) {
  const arA = a.width / Math.max(1, a.height);
  const arB = b.width / Math.max(1, b.height);
  return clamp(1 - Math.abs(arA - arB) * 0.8);
}

function pixelSimilarity(a: Photo, b: Photo) {
  const hamming = Math.min(
    hammingDistance(a.analysis.aHash, b.analysis.aHash),
    hammingDistance(a.analysis.dHash, b.analysis.dHash),
  );
  const hash = clamp(1 - hamming / 32);
  const feature =
    a.analysis.feature.length === b.analysis.feature.length
      ? clamp((cosineSimilarity(a.analysis.feature, b.analysis.feature) + 1) / 2)
      : 0;
  const palette =
    1 -
    Math.min(
      1,
      Math.abs(a.analysis.avgR - b.analysis.avgR) +
        Math.abs(a.analysis.avgG - b.analysis.avgG) +
        Math.abs(a.analysis.avgB - b.analysis.avgB),
    );
  return clamp(hash * 0.4 + feature * 0.4 + palette * 0.2);
}

function cropSimilarity(a: Photo, b: Photo) {
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const areaRatio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
  const aspect = aspectSimilarity(a, b);
  return clamp(areaRatio * 0.55 + aspect * 0.45);
}

function compositionSimilarity(a: Photo, b: Photo) {
  const aPeople = a.analysis.peopleBoxes ?? a.analysis.faceBoxes ?? [];
  const bPeople = b.analysis.peopleBoxes ?? b.analysis.faceBoxes ?? [];
  if (!aPeople.length && !bPeople.length) return pixelSimilarity(a, b);
  if (aPeople.length !== bPeople.length) return 0.35;
  const layout = aPeople.reduce((sum, box, index) => {
    const other = bPeople[index];
    if (!other) return sum;
    const ax = (box.x + box.w / 2) / Math.max(1, a.width);
    const ay = (box.y + box.h / 2) / Math.max(1, a.height);
    const bx = (other.x + other.w / 2) / Math.max(1, b.width);
    const by = (other.y + other.h / 2) / Math.max(1, b.height);
    return sum + clamp(1 - Math.hypot(ax - bx, ay - by) * 2);
  }, 0);
  return clamp(layout / Math.max(1, aPeople.length));
}

function duplicateReason(photos: Photo[]) {
  if (photos.length <= 1) return "Single photo; no duplicate decision needed.";
  const [a, b] = photos;
  if (isExactDuplicate(a, b)) return "Exact duplicate fingerprint/hash match.";
  const sim = duplicateConfidence(a, b);
  const reasons = [];
  if (sim.pixel >= 0.9) reasons.push("nearly identical pixels/background");
  if (sim.composition >= 0.88) reasons.push("matching subject framing");
  if (sim.crop >= 0.92) reasons.push("same crop/aspect");
  if (sim.people >= 0.75) reasons.push("same face count/layout");
  if (sim.objects >= 0.55) reasons.push("same main objects");
  return reasons.length
    ? `Grouped by ${reasons.join(", ")}.`
    : "Grouped by conservative duplicate confidence.";
}

function groupConfidence(photos: Photo[]) {
  if (photos.length <= 1) return 0;
  const values: number[] = [];
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      values.push(duplicateConfidence(photos[i], photos[j]).score);
    }
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function bestDuplicatePhoto(photos: Photo[]) {
  return [...photos].sort((a, b) => b.overall - a.overall)[0];
}

function hammingDistance(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let value = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (value) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
}

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function clamp(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function find(parent: number[], index: number): number {
  if (parent[index] !== index) parent[index] = find(parent, parent[index]);
  return parent[index];
}

function union(parent: number[], a: number, b: number) {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[rb] = ra;
}
