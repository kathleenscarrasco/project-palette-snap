import type { CollectionAnalysis, EventAnalysis, Photo } from "../types";
import { withUnifiedAnalysis } from "./unified-analysis";

export type EventGroup = EventAnalysis & {
  photos: Photo[];
};

export type CollectionGroup = CollectionAnalysis & {
  events: EventGroup[];
  photos: Photo[];
};

export type OrganizationResult = {
  photos: Photo[];
  events: EventGroup[];
  collections: CollectionGroup[];
};

export function organizePhotos(photos: Photo[]): OrganizationResult {
  const events = buildEventGroups(photos);
  const collections = buildCollections(events);
  const eventByPhoto = new Map<string, EventAnalysis>();
  const collectionByPhoto = new Map<string, CollectionAnalysis>();

  events.forEach((event) => {
    event.photos.forEach((photo) => eventByPhoto.set(photo.id, eventSummary(event)));
  });
  collections.forEach((collection) => {
    collection.photos.forEach((photo) =>
      collectionByPhoto.set(photo.id, collectionSummary(collection)),
    );
  });

  return {
    events,
    collections,
    photos: photos.map((photo) =>
      withUnifiedAnalysis({
        ...photo,
        eventGroup: eventByPhoto.get(photo.id),
        collectionGroup: collectionByPhoto.get(photo.id),
      }),
    ),
  };
}

function buildEventGroups(photos: Photo[]): EventGroup[] {
  const groups: Photo[][] = [];
  const sorted = [...photos].sort((a, b) => (a.lastModified ?? 0) - (b.lastModified ?? 0));

  for (const photo of sorted) {
    const match = groups.find((group) => sameEvent(group[0], photo));
    if (match) match.push(photo);
    else groups.push([photo]);
  }

  return groups.map((group, index) => {
    const photos = [...group].sort((a, b) => rankingScore(b) - rankingScore(a));
    const cover = photos[0];
    const title = eventTitle(photos);
    return {
      groupId: `event_${index + 1}_${slug(title)}`,
      title,
      description: eventDescription(photos),
      coverPhoto: cover.id,
      photoCount: photos.length,
      estimatedTimeRange: timeRange(photos),
      estimatedLocation: undefined,
      photos,
    };
  });
}

function buildCollections(events: EventGroup[]): CollectionGroup[] {
  const groups: EventGroup[][] = [];
  for (const event of events) {
    const match = groups.find((group) => sameCollection(group[0], event));
    if (match) match.push(event);
    else groups.push([event]);
  }

  return groups.map((events, index) => {
    const photos = events
      .flatMap((event) => event.photos)
      .sort((a, b) => rankingScore(b) - rankingScore(a));
    const title = collectionTitle(events);
    return {
      groupId: `collection_${index + 1}_${slug(title)}`,
      title,
      summary: `${events.length} event${events.length === 1 ? "" : "s"} organized from related scenes and dates.`,
      coverPhoto: photos[0]?.id ?? "",
      eventCount: events.length,
      photoCount: photos.length,
      estimatedDateRange: timeRange(photos),
      events,
      photos,
    };
  });
}

function sameEvent(a: Photo, b: Photo) {
  if (a.id === b.id) return true;
  if (a.duplicateClusterId && a.duplicateClusterId === b.duplicateClusterId) return true;

  const timeClose = timeDistance(a, b) <= 1000 * 60 * 60 * 4;
  const veryCloseTime = timeDistance(a, b) <= 1000 * 60 * 45;
  const aScene = knownSceneKey(a);
  const bScene = knownSceneKey(b);
  const sceneClose = Boolean(aScene) && aScene === bScene && !isBroadScene(aScene);
  const labelsClose = labelOverlap(a, b) >= 0.55;
  const aFaces = a.faceAnalysis?.numberOfFaces ?? a.peopleCount;
  const bFaces = b.faceAnalysis?.numberOfFaces ?? b.peopleCount;
  const peopleClose = Math.max(aFaces, bFaces) > 0 && Math.abs(aFaces - bFaces) <= 1;
  const objectClose = objectOverlap(a, b) >= 0.42;
  const strongObjectClose = objectOverlap(a, b) >= 0.6;
  const visualClose = visualSimilarity(a, b) >= 0.88;
  const sameMoment =
    visualClose &&
    (veryCloseTime || objectClose || sceneClose || a.duplicateClusterId === b.duplicateClusterId);

  return (
    sameMoment ||
    (timeClose && sceneClose && (objectClose || labelsClose || visualClose)) ||
    (timeClose && strongObjectClose && (labelsClose || peopleClose || visualClose))
  );
}

function sameCollection(a: EventGroup, b: EventGroup) {
  const timeClose = eventTimeDistance(a, b) <= 1000 * 60 * 60 * 24 * 14;
  const aScene = knownSceneKey(a.photos[0]);
  const bScene = knownSceneKey(b.photos[0]);
  const sceneClose = Boolean(aScene) && aScene === bScene;
  const travel = isTravelEvent(a) || isTravelEvent(b);
  return (timeClose && (sceneClose || travel)) || (travel && sceneClose);
}

function eventTitle(photos: Photo[]) {
  const labels = labelCounts(photos);
  const objects = topObjects(photos);
  const hasPeople = photos.some(
    (photo) => (photo.faceAnalysis?.numberOfFaces ?? photo.peopleCount) > 0,
  );
  if (labels.beach) return hasPeople ? "Beach Portraits" : "Beach Views";
  if (labels.food) return objects.includes("drink") ? "Food & Drinks" : "Food Moments";
  if (labels.pets) return "Pet Moments";
  if (labels.sports) return "Sports Moment";
  if (
    labels.city &&
    objects.some((object) => ["building", "street", "architecture"].includes(object))
  ) {
    return "City Details";
  }
  if (labels.city) return hasPeople ? "City Portraits" : "City Views";
  if (labels.mountains || labels.landscape) return hasPeople ? "Scenic Portraits" : "Scenic Views";
  const specificObject = objects.find(isSpecificObjectLabel);
  if (specificObject) return titleCase(specificObject);
  const scene = sceneKey(photos[0]);
  return scene === "unknown" || scene === "random"
    ? photos.length > 1
      ? "Similar Moment"
      : "Photo Moment"
    : titleCase(scene);
}

function eventDescription(photos: Photo[]) {
  const count = photos.length;
  const scene = eventTitle(photos).toLowerCase();
  if (count === 1) return `1 photo tagged as ${scene}.`;

  const visualPairs = pairScores(photos, visualSimilarity);
  const objectPairs = pairScores(photos, objectOverlap);
  const visuallySimilar =
    visualPairs.length > 0 &&
    visualPairs.reduce((sum, value) => sum + value, 0) / visualPairs.length >= 0.86;
  const objectsSimilar =
    objectPairs.length > 0 &&
    objectPairs.reduce((sum, value) => sum + value, 0) / objectPairs.length >= 0.42;
  const qualifier = visuallySimilar
    ? "visually similar"
    : objectsSimilar
      ? "related"
      : "loosely related";
  return `${count} ${qualifier} photos in ${scene}.`;
}

function collectionTitle(events: EventGroup[]) {
  if (events.length === 1) return events[0].title;
  if (events.some(isTravelEvent)) return "Trip Collection";
  return "Recent Memories";
}

function eventSummary(event: EventGroup): EventAnalysis {
  const { photos: _photos, ...summary } = event;
  return summary;
}

function collectionSummary(collection: CollectionGroup): CollectionAnalysis {
  const { events: _events, photos: _photos, ...summary } = collection;
  return summary;
}

function sceneKey(photo: Photo) {
  return photo.sceneAnalysis?.primaryScene ?? photo.photoType;
}

function knownSceneKey(photo: Photo) {
  const scene = sceneKey(photo);
  return scene === "unknown" || scene === "random" ? "" : scene;
}

function isTravelEvent(event: EventGroup) {
  return event.photos.some((photo) => {
    const labels = photo.sceneAnalysis?.labels;
    return labels?.beach || labels?.city || labels?.mountains || labels?.landscape;
  });
}

function labelCounts(photos: Photo[]) {
  return photos.reduce(
    (acc, photo) => {
      const labels = photo.sceneAnalysis?.labels;
      if (!labels) return acc;
      (Object.keys(labels) as (keyof typeof labels)[]).forEach((key) => {
        if (labels[key]) acc[key] = (acc[key] ?? 0) + 1;
      });
      return acc;
    },
    {} as Record<string, number>,
  );
}

function labelOverlap(a: Photo, b: Photo) {
  const aLabels = activeLabels(a);
  const bLabels = activeLabels(b);
  if (!aLabels.size && !bLabels.size) return 0;
  const shared = [...aLabels].filter((label) => bLabels.has(label)).length;
  return shared / (new Set([...aLabels, ...bLabels]).size || 1);
}

function activeLabels(photo: Photo) {
  const labels = photo.sceneAnalysis?.labels;
  if (!labels) return new Set<string>();
  return new Set((Object.keys(labels) as (keyof typeof labels)[]).filter((key) => labels[key]));
}

function objectOverlap(a: Photo, b: Photo) {
  const aObjects = new Set(meaningfulObjects(a));
  const bObjects = new Set(meaningfulObjects(b));
  if (!aObjects.size && !bObjects.size) return 0;
  const shared = [...aObjects].filter((label) => bObjects.has(label)).length;
  return shared / (new Set([...aObjects, ...bObjects]).size || 1);
}

function meaningfulObjects(photo: Photo) {
  return (photo.detectedObjects ?? [])
    .map((object) => object.labelNormalized)
    .filter((label) => label && isSpecificObjectLabel(label));
}

function isSpecificObjectLabel(label: string) {
  const ignored = new Set([
    "person",
    "people",
    "human",
    "face",
    "clothing",
    "sky",
    "outdoor",
    "indoor",
    "text",
    "text box",
    "button",
    "icon",
    "screen",
    "screenshot",
    "rectangle",
    "circle",
    "line",
    "shape",
    "document",
    "receipt",
    "paper",
    "website",
    "app",
    "ui",
    "unknown",
  ]);
  return Boolean(label) && !ignored.has(label.toLowerCase());
}

function topObjects(photos: Photo[]) {
  const counts = new Map<string, number>();
  photos.forEach((photo) => {
    meaningfulObjects(photo).forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
}

function visualSimilarity(a: Photo, b: Photo) {
  const feature =
    a.analysis.feature.length === b.analysis.feature.length && a.analysis.feature.length > 0
      ? (cosineSimilarity(a.analysis.feature, b.analysis.feature) + 1) / 2
      : 0;
  const hamming = Math.min(
    hammingDistance(a.analysis.aHash, b.analysis.aHash),
    hammingDistance(a.analysis.dHash, b.analysis.dHash),
  );
  const hash = Math.max(0, 1 - hamming / 32);
  const palette =
    1 -
    Math.min(
      1,
      Math.abs(a.analysis.avgR - b.analysis.avgR) +
        Math.abs(a.analysis.avgG - b.analysis.avgG) +
        Math.abs(a.analysis.avgB - b.analysis.avgB),
    );
  return Math.max(0, Math.min(1, feature * 0.45 + hash * 0.35 + palette * 0.2));
}

function pairScores(photos: Photo[], score: (a: Photo, b: Photo) => number) {
  const values: number[] = [];
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      values.push(score(photos[i], photos[j]));
    }
  }
  return values;
}

function isBroadScene(scene: string) {
  return ["person", "people", "outdoor", "indoors", "random", "unknown"].includes(
    scene.toLowerCase(),
  );
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

function timeDistance(a: Photo, b: Photo) {
  const aTime = a.lastModified ?? 0;
  const bTime = b.lastModified ?? 0;
  if (!aTime || !bTime) return Number.POSITIVE_INFINITY;
  return Math.abs(aTime - bTime);
}

function eventTimeDistance(a: EventGroup, b: EventGroup) {
  const aTime = a.photos[0].lastModified ?? 0;
  const bTime = b.photos[0].lastModified ?? 0;
  if (!aTime || !bTime) return Number.POSITIVE_INFINITY;
  return Math.abs(aTime - bTime);
}

function timeRange(photos: Photo[]) {
  const times = photos.map((photo) => photo.lastModified).filter(Boolean) as number[];
  if (!times.length) return undefined;
  const start = new Date(Math.min(...times)).toLocaleDateString();
  const end = new Date(Math.max(...times)).toLocaleDateString();
  return start === end ? start : `${start} - ${end}`;
}

function rankingScore(photo: Photo) {
  return photo.ranking?.overallScore ?? photo.overall;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
}

function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
