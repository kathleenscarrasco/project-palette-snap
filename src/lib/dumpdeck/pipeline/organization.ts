import type { CollectionAnalysis, EventAnalysis, Photo } from "../types";
import { withUnifiedAnalysis } from "./unified-analysis";

export type EventGroup = EventAnalysis & {
  photos: Photo[];
  confidence: number;
  explanation: string[];
};

export type CollectionGroup = CollectionAnalysis & {
  events: EventGroup[];
  photos: Photo[];
  confidence: number;
  explanation: string[];
};

export type OrganizationResult = {
  photos: Photo[];
  events: EventGroup[];
  collections: CollectionGroup[];
};

type SemanticMetadata = {
  photo: Photo;
  locationType: string;
  locationConfidence: number;
  primarySubjects: Set<string>;
  objects: Set<string>;
  labels: Set<string>;
  faceCount: number;
  dominantColors: string[];
  timestamp?: number;
  aestheticScore: number;
  hasText: boolean;
  isPetDominant: boolean;
  isFoodConfident: boolean;
  isOutfitConfident: boolean;
  isSelfieConfident: boolean;
};

type PairSignal = {
  score: number;
  reasons: string[];
};

type TitleCandidate = {
  title: string;
  confidence: number;
};

const EVENT_CONFIDENCE_THRESHOLD = 0.54;
const EVENT_STRONG_CONFIDENCE_THRESHOLD = 0.68;
const COLLECTION_CONFIDENCE_THRESHOLD = 0.62;
const GENERIC_TITLES = new Set([
  "photo moment",
  "memory",
  "memories",
  "scene",
  "miscellaneous",
  "similar moment",
  "recent memories",
  "camera roll highlights",
]);

export function organizePhotos(photos: Photo[]): OrganizationResult {
  const metadata = new Map(photos.map((photo) => [photo.id, buildSemanticMetadata(photo)]));
  const events = buildEventGroups(photos, metadata);
  const collections = buildCollections(events, metadata);
  const eventByPhoto = new Map<string, EventAnalysis>();
  const collectionByPhoto = new Map<string, CollectionAnalysis>();

  events.forEach((event) => {
    if (event.photos.length > 1) {
      event.photos.forEach((photo) => eventByPhoto.set(photo.id, eventSummary(event)));
    }
  });
  collections.forEach((collection) => {
    if (collection.photos.length > 1) {
      collection.photos.forEach((photo) =>
        collectionByPhoto.set(photo.id, collectionSummary(collection)),
      );
    }
  });

  console.debug("[dumpdeck] semantic organization", {
    events: events.map((event) => ({
      id: event.groupId,
      title: event.title,
      photoCount: event.photoCount,
      confidence: event.confidence,
      explanation: event.explanation,
      photos: event.photos.map((photo) => photo.name),
    })),
    collections: collections.map((collection) => ({
      id: collection.groupId,
      title: collection.title,
      photoCount: collection.photoCount,
      confidence: collection.confidence,
      explanation: collection.explanation,
      events: collection.events.map((event) => event.title),
    })),
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

function buildEventGroups(photos: Photo[], metadata: Map<string, SemanticMetadata>): EventGroup[] {
  const groups: Photo[][] = [];
  const sorted = [...photos].sort((a, b) => (a.lastModified ?? 0) - (b.lastModified ?? 0));

  for (const photo of sorted) {
    let bestMatch: { group: Photo[]; signal: PairSignal } | null = null;
    for (const group of groups) {
      const signal = eventAffinity(group, photo, metadata);
      if (!bestMatch || signal.score > bestMatch.signal.score) {
        bestMatch = { group, signal };
      }
    }

    if (bestMatch && bestMatch.signal.score >= EVENT_CONFIDENCE_THRESHOLD) {
      bestMatch.group.push(photo);
    } else {
      groups.push([photo]);
    }
  }

  const conservativeGroups = splitWeakGroups(groups, metadata);

  return conservativeGroups.map((group, index) => {
    const photos = [...group].sort((a, b) => rankingScore(b) - rankingScore(a));
    const cover = photos[0];
    const confidence = groupConfidence(photos, metadata, eventPairSignal);
    const title = validateTitle(eventTitle(photos, metadata), photos, metadata);
    const explanation = eventExplanation(photos, metadata);
    return {
      groupId: `event_${index + 1}_${slug(title)}`,
      title,
      description: eventDescription(photos, metadata, explanation),
      coverPhoto: cover.id,
      photoCount: photos.length,
      estimatedTimeRange: timeRange(photos),
      estimatedLocation: commonLocation(photos, metadata),
      confidence,
      explanation,
      photos,
    };
  });
}

function buildCollections(
  events: EventGroup[],
  metadata: Map<string, SemanticMetadata>,
): CollectionGroup[] {
  const groups: EventGroup[][] = [];
  for (const event of events.filter((candidate) => candidate.photos.length > 1)) {
    let bestMatch: { group: EventGroup[]; score: number } | null = null;
    for (const group of groups) {
      const score = collectionAffinity(group, event, metadata);
      if (!bestMatch || score > bestMatch.score) bestMatch = { group, score };
    }
    if (bestMatch && bestMatch.score >= COLLECTION_CONFIDENCE_THRESHOLD) {
      bestMatch.group.push(event);
    } else {
      groups.push([event]);
    }
  }

  return groups.map((events, index) => {
    const photos = events
      .flatMap((event) => event.photos)
      .sort((a, b) => rankingScore(b) - rankingScore(a));
    const confidence = collectionConfidence(events, metadata);
    const title = validateTitle(collectionTitle(events, metadata), photos, metadata);
    const explanation = collectionExplanation(events, metadata);
    return {
      groupId: `collection_${index + 1}_${slug(title)}`,
      title,
      summary: `${events.length} event${events.length === 1 ? "" : "s"} grouped because ${explanation.join(", ")}.`,
      coverPhoto: photos[0]?.id ?? "",
      eventCount: events.length,
      photoCount: photos.length,
      estimatedDateRange: timeRange(photos),
      confidence,
      explanation,
      events,
      photos,
    };
  });
}

function splitWeakGroups(groups: Photo[][], metadata: Map<string, SemanticMetadata>): Photo[][] {
  const out: Photo[][] = [];
  for (const group of groups) {
    if (group.length <= 1) {
      out.push(group);
      continue;
    }
    const confidence = groupConfidence(group, metadata, eventPairSignal);
    const cohesion = groupCohesion(group, metadata);
    const span = timeSpanMs(group);
    const suspiciousLargeGroup =
      group.length > 10 &&
      (!Number.isFinite(span) || span > 1000 * 60 * 90) &&
      cohesion.visualP25 < 0.72;
    const weakGroup =
      confidence < 0.5 ||
      (cohesion.visualP25 < 0.54 && cohesion.signalP25 < 0.5) ||
      suspiciousLargeGroup;
    if (weakGroup || suspiciousLargeGroup) {
      const recovered = recoverSubgroups(group, metadata);
      console.debug("[dumpdeck] split weak organization group", {
        memberIds: group.map((photo) => photo.id),
        memberNames: group.map((photo) => photo.name),
        confidence,
        cohesion,
        recoveredGroupSizes: recovered.map((candidate) => candidate.length),
        splitDecision: recovered.some((candidate) => candidate.length > 1)
          ? "subclusters"
          : "standalone",
      });
      out.push(...recovered);
      continue;
    }
    out.push(group);
  }
  return out;
}

function recoverSubgroups(
  photos: Photo[],
  metadata: Map<string, SemanticMetadata>,
  depth = 0,
): Photo[][] {
  if (photos.length <= 2 || depth > 1) return photos.map((photo) => [photo]);

  const parent = photos.map((_, index) => index);
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      const signal = sameMomentSignal(photos[i], photos[j], metadata);
      if (signal.score >= sameMomentThreshold(photos[i], photos[j])) {
        union(parent, i, j);
      }
    }
  }

  const components = new Map<number, Photo[]>();
  photos.forEach((photo, index) => {
    const root = find(parent, index);
    components.set(root, [...(components.get(root) ?? []), photo]);
  });

  const recovered: Photo[][] = [];
  for (const component of components.values()) {
    if (component.length <= 1) {
      recovered.push(component);
      continue;
    }
    const cohesion = groupCohesion(component, metadata);
    const span = timeSpanMs(component);
    const largeNeedsTimeSupport =
      component.length >= 9 &&
      (!Number.isFinite(span) || span > 1000 * 60 * 90) &&
      cohesion.visualP25 < 0.74;
    const valid =
      cohesion.signalMean >= 0.54 &&
      (cohesion.visualP25 >= 0.54 || cohesion.signalP25 >= 0.5) &&
      !largeNeedsTimeSupport;
    if (valid) {
      recovered.push(component);
    } else {
      recovered.push(...recoverSubgroups(component, metadata, depth + 1));
    }
  }

  return recovered.length ? recovered : photos.map((photo) => [photo]);
}

function sameMomentSignal(a: Photo, b: Photo, metadata: Map<string, SemanticMetadata>) {
  const aMeta = metadata.get(a.id) ?? buildSemanticMetadata(a);
  const bMeta = metadata.get(b.id) ?? buildSemanticMetadata(b);
  const visual = visualSimilarity(a, b);
  const time = timeSignal(a, b).score;
  const scene = locationSimilarity(aMeta, bMeta);
  const subject = subjectSimilarity(aMeta, bMeta);
  const people = peopleSimilarity(aMeta, bMeta);
  const location = sameLocationFamily(aMeta.locationType, bMeta.locationType) ? 0.55 : scene;
  const score =
    visual * 0.4 + time * 0.25 + scene * 0.15 + subject * 0.1 + people * 0.05 + location * 0.05;
  return { score: clamp(score), visual, time, scene, subject, people, location };
}

function sameMomentThreshold(a: Photo, b: Photo) {
  const distance = timeDistance(a, b);
  if (distance <= 1000 * 60 * 2) return 0.58;
  if (distance <= 1000 * 60 * 10) return 0.62;
  if (distance <= 1000 * 60 * 30) return 0.68;
  if (distance <= 1000 * 60 * 90) return 0.74;
  return 0.82;
}

function groupCohesion(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  const visual = pairScores(photos, visualSimilarity);
  const signals = pairScores(photos, (a, b) => eventPairSignal(a, b, metadata).score);
  const locations = locationCounts(photos, metadata);
  const subjects = subjectCounts(photos, metadata);
  return {
    visualMean: average(visual),
    visualP25: percentile(visual, 0.25),
    signalMean: average(signals),
    signalP25: percentile(signals, 0.25),
    locationConsistency: topEntry(locations)?.[1]
      ? topEntry(locations)![1] / Math.max(1, photos.length)
      : 0,
    subjectConsistency: topEntry(subjects)?.[1]
      ? topEntry(subjects)![1] / Math.max(1, photos.length)
      : 0,
    peopleCountDistribution: peopleCountDistribution(photos, metadata),
    semanticLabelDistribution: Object.fromEntries(subjects),
  };
}

function eventAffinity(
  group: Photo[],
  photo: Photo,
  metadata: Map<string, SemanticMetadata>,
): PairSignal {
  const signals = group.map((candidate) => eventPairSignal(candidate, photo, metadata));
  const best = signals.reduce((winner, signal) => (signal.score > winner.score ? signal : winner), {
    score: 0,
    reasons: [] as string[],
  });
  const average =
    signals.reduce((sum, signal) => sum + signal.score, 0) / Math.max(1, signals.length);
  const score =
    best.score >= EVENT_STRONG_CONFIDENCE_THRESHOLD
      ? best.score
      : best.score * 0.72 + average * 0.28;
  return { score, reasons: best.reasons };
}

function eventPairSignal(a: Photo, b: Photo, metadata: Map<string, SemanticMetadata>): PairSignal {
  if (a.id === b.id) return { score: 1, reasons: ["same photo"] };
  if (a.duplicateClusterId && a.duplicateClusterId === b.duplicateClusterId) {
    return { score: 1, reasons: ["same duplicate cluster"] };
  }

  const aMeta = metadata.get(a.id) ?? buildSemanticMetadata(a);
  const bMeta = metadata.get(b.id) ?? buildSemanticMetadata(b);
  const reasons: string[] = [];
  let score = 0;

  const time = timeSignal(a, b);
  score += time.score * 0.2;
  if (time.reason) reasons.push(time.reason);

  const visual = visualSimilarity(a, b);
  score += visual * 0.24;
  if (visual >= 0.9) reasons.push(`${Math.round(visual * 100)}% visual similarity`);
  else if (visual >= 0.78) reasons.push("similar background and framing");

  const location = locationSimilarity(aMeta, bMeta);
  score += location * 0.18;
  if (location >= 0.8) reasons.push(`same ${prettyLocation(aMeta.locationType)} setting`);

  const subjects = subjectSimilarity(aMeta, bMeta);
  score += subjects * 0.15;
  if (subjects >= 0.65) reasons.push("matching main subjects");

  const people = peopleSimilarity(aMeta, bMeta);
  score += people * 0.12;
  if (people >= 0.85 && Math.max(aMeta.faceCount, bMeta.faceCount) > 0) {
    reasons.push(`same ${Math.max(aMeta.faceCount, bMeta.faceCount)} face count`);
  } else if (people >= 0.65 && Math.max(aMeta.faceCount, bMeta.faceCount) > 0) {
    reasons.push("similar people signal");
  }

  const color = colorSimilarity(aMeta, bMeta);
  score += color * 0.06;
  if (color >= 0.75) reasons.push("similar colors/lighting");

  const lighting = lightingSimilarity(a, b);
  score += lighting * 0.05;
  if (lighting >= 0.78) reasons.push("similar lighting");

  const strongSignalCount = [
    time.score >= 0.68,
    visual >= 0.82,
    location >= 0.8,
    subjects >= 0.62,
    people >= 0.85 && Math.max(aMeta.faceCount, bMeta.faceCount) > 0,
    color >= 0.8 && lighting >= 0.78,
  ].filter(Boolean).length;
  const hasVisualAnchor = visual >= 0.82 || a.duplicateClusterId === b.duplicateClusterId;
  const hasTimeVisualSupport =
    time.score >= 0.88 && visual >= 0.68 && (subjects >= 0.35 || location >= 0.55 || color >= 0.65);

  if (strongSignalCount < 2 && !hasTimeVisualSupport) {
    return { score: Math.min(clamp(score), 0.44), reasons: reasons.slice(0, 5) };
  }

  if (!hasVisualAnchor && !hasTimeVisualSupport) {
    return { score: Math.min(clamp(score), 0.44), reasons: reasons.slice(0, 5) };
  }

  return { score: clamp(score), reasons: reasons.slice(0, 5) };
}

function collectionAffinity(
  group: EventGroup[],
  event: EventGroup,
  metadata: Map<string, SemanticMetadata>,
) {
  const targetPhotos = event.photos;
  const scores = group.map((candidate) => {
    const distance = eventTimeDistance(candidate, event);
    const timeClose =
      distance <= 1000 * 60 * 15
        ? 0.24
        : distance <= 1000 * 60 * 90
          ? 0.12
          : distance <= 1000 * 60 * 60 * 8
            ? 0.04
            : 0;
    const location = jaccard(
      new Set(
        candidate.photos.map((photo) => metadata.get(photo.id)?.locationType).filter(Boolean),
      ),
      new Set(targetPhotos.map((photo) => metadata.get(photo.id)?.locationType).filter(Boolean)),
    );
    const subjects = jaccard(
      eventSubjectSet(candidate, metadata),
      eventSubjectSet(event, metadata),
    );
    const travel = isTravelEvent(candidate, metadata) && isTravelEvent(event, metadata) ? 0.04 : 0;
    const visual = averageCrossScore(candidate.photos, targetPhotos, visualSimilarity);
    const compatible = visual >= 0.72 || timeClose >= 0.12 || (location >= 0.8 && subjects >= 0.45);
    if (!compatible) return Math.min(0.38, visual * 0.18 + location * 0.12 + subjects * 0.08);
    return timeClose + location * 0.24 + subjects * 0.2 + travel + visual * 0.22;
  });
  return scores.length ? Math.max(...scores) : 0;
}

function eventTitle(photos: Photo[], metadata: Map<string, SemanticMetadata>): TitleCandidate {
  const subjects = subjectCounts(photos, metadata);
  const locations = locationCounts(photos, metadata);
  const topSubject = topEntry(subjects);
  const topLocation = topEntry(locations);
  const hasPeople = photos.some((photo) => (metadata.get(photo.id)?.faceCount ?? 0) > 0);
  const faceCount = maxFaceCount(photos, metadata);
  const peopleDescriptor =
    faceCount >= 4
      ? "Group Photos"
      : faceCount === 3
        ? "Three-Person Photos"
        : faceCount === 2
          ? "Two-Person Photos"
          : "Solo Portraits";

  if (topSubject?.[0] === "cats" || topSubject?.[0] === "dogs" || topSubject?.[0] === "pets") {
    return { title: `${titleCase(topSubject[0])}`, confidence: topSubject[1] / photos.length };
  }
  if (topLocation?.[0] === "beach" || topLocation?.[0] === "ocean") {
    if (isSunsetEvent(photos)) {
      return {
        title: hasPeople ? "Golden Hour Beach Photos" : "Beach Sunset",
        confidence: 0.86,
      };
    }
    return { title: hasPeople ? "Beach Day" : "Ocean Views", confidence: 0.8 };
  }
  if (topLocation?.[0] === "restaurant") {
    return {
      title: hasPeople ? "Dinner Photos" : "Restaurant Details",
      confidence: 0.78,
    };
  }
  if (topSubject?.[0] === "food") {
    return { title: "Food & Drinks", confidence: 0.82 };
  }
  if (topLocation?.[0] === "airport") return { title: "Airport Travel", confidence: 0.82 };
  if (topLocation?.[0] === "hotel") return { title: "Hotel Moments", confidence: 0.74 };
  if (topLocation?.[0] === "concert") return { title: "Concert Night", confidence: 0.82 };
  if (topLocation?.[0] === "park") {
    return { title: hasPeople ? "Park Day" : "Park Views", confidence: 0.74 };
  }
  if (topLocation?.[0] === "mountains") {
    return { title: hasPeople ? "Mountain Portraits" : "Mountain Views", confidence: 0.84 };
  }
  if (topLocation?.[0] === "city" || topLocation?.[0] === "street") {
    if (topSubject?.[0] === "architecture" || topSubject?.[0] === "buildings") {
      return { title: "Old Town Architecture", confidence: 0.76 };
    }
    return { title: hasPeople ? "City Portraits" : "City Streets", confidence: 0.72 };
  }
  if (topSubject?.[0] === "architecture" || topSubject?.[0] === "buildings") {
    return { title: "Architecture Details", confidence: 0.78 };
  }
  if (topSubject?.[0] === "vehicles") return { title: "Travel Details", confidence: 0.68 };
  if (isSunsetEvent(photos)) {
    return { title: hasPeople ? "Golden Hour Portraits" : "Sunset Views", confidence: 0.82 };
  }
  if (topSubject?.[0] === "outfit") {
    return { title: "Outfit Details", confidence: 0.72 };
  }
  if (hasPeople) return { title: peopleDescriptor, confidence: 0.62 };
  if (topLocation && topLocation[0] !== "unknown") {
    return { title: `${titleCase(prettyLocation(topLocation[0]))} Photos`, confidence: 0.58 };
  }
  if (topSubject && topSubject[0] !== "unknown") {
    return { title: titleCase(topSubject[0]), confidence: 0.56 };
  }
  return { title: "Similar Photos", confidence: 0.42 };
}

function collectionTitle(
  events: EventGroup[],
  metadata: Map<string, SemanticMetadata>,
): TitleCandidate {
  if (events.length === 1) return { title: events[0].title, confidence: events[0].confidence };
  const photos = events.flatMap((event) => event.photos);
  const locations = locationCounts(photos, metadata);
  const subjects = subjectCounts(photos, metadata);
  const topLocation = topEntry(locations);
  const topSubject = topEntry(subjects);
  if (isTripCollection(events, metadata) && collectionConfidence(events, metadata) >= 0.74) {
    if (topLocation?.[0] === "beach" || topLocation?.[0] === "ocean") {
      return { title: "Beach Trip", confidence: 0.82 };
    }
    if (topLocation?.[0] === "city" || topSubject?.[0] === "architecture") {
      return { title: "City Trip", confidence: 0.78 };
    }
    return { title: "Travel Highlights", confidence: 0.7 };
  }
  if (topLocation?.[0] === "beach" || topLocation?.[0] === "ocean") {
    return { title: "Beach Highlights", confidence: 0.76 };
  }
  if (topSubject?.[0] === "food") return { title: "Dinner & Drinks", confidence: 0.74 };
  if (topSubject?.[0] === "pets" || topSubject?.[0] === "cats" || topSubject?.[0] === "dogs") {
    return { title: "Pet Photos", confidence: 0.78 };
  }
  if (photos.some((photo) => (metadata.get(photo.id)?.faceCount ?? 0) > 0)) {
    return { title: "People & Places", confidence: 0.62 };
  }
  return { title: "Similar Photos", confidence: 0.5 };
}

function validateTitle(
  candidate: TitleCandidate,
  photos: Photo[],
  metadata: Map<string, SemanticMetadata>,
) {
  let title = candidate.title.trim();
  const lower = title.toLowerCase();
  const subjects = subjectCounts(photos, metadata);
  const topSubject = topEntry(subjects);
  const hasFoodEvidence = evidenceRatio(photos, metadata, (meta) => meta.isFoodConfident) >= 0.7;
  const hasOutfitEvidence =
    evidenceRatio(photos, metadata, (meta) => meta.isOutfitConfident) >= 0.75;
  const hasSelfieEvidence =
    evidenceRatio(photos, metadata, (meta) => meta.isSelfieConfident) >= 0.75;
  const petDominant = evidenceRatio(photos, metadata, (meta) => meta.isPetDominant) >= 0.7;
  const beachEvidence =
    evidenceRatio(photos, metadata, (meta) => ["beach", "ocean"].includes(meta.locationType)) >=
    0.7;
  const architectureEvidence =
    evidenceRatio(photos, metadata, (meta) => meta.primarySubjects.has("architecture")) >= 0.65;

  if (
    /food|dinner|drink|brunch|restaurant/.test(lower) &&
    !hasFoodEvidence &&
    !hasLocation(photos, metadata, "restaurant")
  ) {
    title = broaderGroundedTitle(photos, metadata);
  }
  if (/outfit|fashion|clothing/.test(lower) && !hasOutfitEvidence) {
    title = petDominant ? petTitle(photos, metadata) : broaderGroundedTitle(photos, metadata);
  }
  if (/selfie/.test(lower) && !hasSelfieEvidence) {
    title = broaderGroundedTitle(photos, metadata);
  }
  if (/couple|boyfriend|girlfriend|husband|wife|family|sibling|mom|dad/i.test(title)) {
    title = neutralPeopleTitle(photos, metadata);
  }
  if (/beach|ocean/.test(lower) && !beachEvidence) {
    title = broaderGroundedTitle(photos, metadata);
  }
  if (/architecture|building|old town/.test(lower) && !architectureEvidence && photos.length > 1) {
    title = broaderGroundedTitle(photos, metadata);
  }
  if (petDominant && !/pet|cat|dog/.test(title.toLowerCase())) title = petTitle(photos, metadata);
  if (candidate.confidence < 0.5 || GENERIC_TITLES.has(title.toLowerCase())) {
    title = broaderGroundedTitle(photos, metadata);
  }
  return title || "Similar Photos";
}

function broaderGroundedTitle(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  const locations = locationCounts(photos, metadata);
  const subjects = subjectCounts(photos, metadata);
  const topLocation = topEntry(locations);
  const topSubject = topEntry(subjects);
  if (topLocation && topLocation[0] !== "unknown") {
    if (isSunsetEvent(photos)) return `${titleCase(prettyLocation(topLocation[0]))} Sunset`;
    return `${titleCase(prettyLocation(topLocation[0]))} Photos`;
  }
  if (topSubject && topSubject[0] !== "unknown") return titleCase(topSubject[0]);
  return photos.some((photo) => (metadata.get(photo.id)?.faceCount ?? 0) > 0)
    ? "People Photos"
    : "Similar Photos";
}

function eventDescription(
  photos: Photo[],
  metadata: Map<string, SemanticMetadata>,
  explanation: string[],
) {
  if (photos.length === 1) {
    const meta = metadata.get(photos[0].id);
    return `1 photo from ${prettyLocation(meta?.locationType ?? "camera roll")}.`;
  }
  return `Grouped because: ${explanation.join("; ")}.`;
}

function eventExplanation(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  if (photos.length <= 1) return ["single standalone photo"];
  const visualPairs = pairScores(photos, visualSimilarity);
  const avgVisual = average(visualPairs);
  const objectPairs = pairScores(photos, (a, b) =>
    subjectSimilarity(
      metadata.get(a.id) ?? buildSemanticMetadata(a),
      metadata.get(b.id) ?? buildSemanticMetadata(b),
    ),
  );
  const peoplePairs = pairScores(photos, (a, b) =>
    peopleSimilarity(
      metadata.get(a.id) ?? buildSemanticMetadata(a),
      metadata.get(b.id) ?? buildSemanticMetadata(b),
    ),
  );
  const reasons: string[] = [];
  const range = timeSpanMs(photos);
  if (Number.isFinite(range) && range <= 1000 * 60 * 10) reasons.push("captured within 10 minutes");
  else if (Number.isFinite(range) && range <= 1000 * 60 * 60)
    reasons.push("captured within an hour");
  const common = commonLocation(photos, metadata);
  if (common) reasons.push(`same ${prettyLocation(common)} setting`);
  if (avgVisual >= 0.9) reasons.push(`${Math.round(avgVisual * 100)}% visual similarity`);
  else if (avgVisual >= 0.78) reasons.push("similar background and framing");
  if (average(peoplePairs) >= 0.82 && maxFaceCount(photos, metadata) > 0) {
    reasons.push(`same ${maxFaceCount(photos, metadata)} face count`);
  }
  if (average(objectPairs) >= 0.65) reasons.push("matching subjects/objects");
  return reasons.length ? reasons : ["specific visual and timing signals"];
}

function collectionExplanation(events: EventGroup[], metadata: Map<string, SemanticMetadata>) {
  const photos = events.flatMap((event) => event.photos);
  const reasons: string[] = [];
  const common = commonLocation(photos, metadata);
  if (common) reasons.push(`shared ${prettyLocation(common)} context`);
  if (isTripCollection(events, metadata)) reasons.push("travel scenes close together");
  const subject = topEntry(subjectCounts(photos, metadata));
  if (subject && subject[0] !== "unknown") reasons.push(`recurring ${prettySubject(subject[0])}`);
  return reasons.length ? reasons : ["specific event context"];
}

function buildSemanticMetadata(photo: Photo): SemanticMetadata {
  const labels = activeLabels(photo);
  const objects = new Set(
    (photo.detectedObjects ?? []).map((object) => normalizeSubject(object.labelNormalized)),
  );
  const location = inferLocationType(photo, labels, objects);
  const primarySubjects = inferPrimarySubjects(photo, labels, objects);
  const faceCount = photo.faceAnalysis?.numberOfFaces ?? photo.peopleCount ?? 0;
  const hasFoodObject = [...objects].some((object) => FOOD_OBJECTS.has(object));
  const isPetDominant =
    labels.has("pets") || objects.has("cats") || objects.has("dogs") || objects.has("pets");
  const isFoodConfident =
    hasFoodObject ||
    ((photo.sceneAnalysis?.confidenceScores.food ?? 0) >= 0.72 &&
      labels.has("food") &&
      location.type === "restaurant");
  const isOutfitConfident =
    !isPetDominant &&
    (photo.tags.includes("Outfit") || photo.photoType === "outfit") &&
    [...objects].some((object) => OUTFIT_OBJECTS.has(object)) &&
    hasProminentPersonFraming(photo);
  const isSelfieConfident = hasSelfieFraming(photo, faceCount);
  return {
    photo,
    locationType: location.type,
    locationConfidence: location.confidence,
    primarySubjects,
    objects,
    labels,
    faceCount,
    dominantColors: dominantColors(photo),
    timestamp: photo.lastModified,
    aestheticScore: photo.aestheticScore?.score ?? photo.scores.aesthetic * 10,
    hasText: objects.has("text") || objects.has("document") || objects.has("screen"),
    isPetDominant,
    isFoodConfident,
    isOutfitConfident,
    isSelfieConfident,
  };
}

const FOOD_OBJECTS = new Set([
  "food",
  "drink",
  "coffee",
  "pizza",
  "plate",
  "dessert",
  "cocktail",
  "restaurant",
]);
const OUTFIT_OBJECTS = new Set(["clothing", "dress", "shoe", "bag", "jewelry", "outfit"]);

function inferLocationType(photo: Photo, labels: Set<string>, objects: Set<string>) {
  const scene =
    `${photo.sceneAnalysis?.primaryScene ?? ""} ${photo.sceneAnalysis?.secondaryScene ?? ""} ${photo.photoType}`.toLowerCase();
  const confidence =
    photo.sceneAnalysis?.confidenceScores.primaryScene ?? photo.photoTypeConfidence;
  if (labels.has("beach") || /beach|ocean|sea|coast|shore/.test(scene))
    return { type: "beach", confidence: Math.max(confidence, 0.75) };
  if (labels.has("mountains") || /mountain|hike|trail/.test(scene))
    return { type: "mountains", confidence: Math.max(confidence, 0.74) };
  if (labels.has("city") || /city|street|old town|urban/.test(scene))
    return { type: "city", confidence: Math.max(confidence, 0.66) };
  if (/airport|plane|airplane|terminal/.test(scene) || objects.has("vehicles"))
    return { type: "airport", confidence: 0.68 };
  if (/restaurant|dinner|cafe|bar/.test(scene) || labels.has("food"))
    return { type: "restaurant", confidence: 0.68 };
  if (/hotel|resort|pool/.test(scene))
    return { type: scene.includes("pool") ? "pool" : "hotel", confidence: 0.66 };
  if (/concert|stage|festival/.test(scene)) return { type: "concert", confidence: 0.72 };
  if (/park|garden|forest|nature/.test(scene))
    return { type: labels.has("landscape") ? "nature" : "park", confidence: 0.64 };
  if (/home|house|bedroom|living room|indoor/.test(scene))
    return { type: "home", confidence: 0.58 };
  if (labels.has("landscape")) return { type: "nature", confidence: 0.6 };
  return { type: "unknown", confidence: 0.25 };
}

function inferPrimarySubjects(photo: Photo, labels: Set<string>, objects: Set<string>) {
  const subjects = new Set<string>();
  const faceCount = photo.faceAnalysis?.numberOfFaces ?? photo.peopleCount ?? 0;
  if (faceCount >= 3) subjects.add("group_people");
  else if (faceCount === 2) subjects.add("two_people");
  else if (faceCount === 1) subjects.add("person");
  if (objects.has("cats")) subjects.add("cats");
  if (objects.has("dogs")) subjects.add("dogs");
  if (labels.has("pets") && !subjects.has("cats") && !subjects.has("dogs")) subjects.add("pets");
  if ([...objects].some((object) => FOOD_OBJECTS.has(object))) subjects.add("food");
  if (labels.has("vehicles")) subjects.add("vehicles");
  if (labels.has("sports")) subjects.add("sports");
  if (labels.has("landscape") || photo.photoType === "landscape") subjects.add("landscapes");
  if (
    [...objects].some((object) => ["building", "architecture", "house", "church"].includes(object))
  ) {
    subjects.add("architecture");
  }
  if (
    !subjects.has("cats") &&
    !subjects.has("dogs") &&
    (photo.tags.includes("Outfit") || photo.photoType === "outfit") &&
    [...objects].some((object) => OUTFIT_OBJECTS.has(object)) &&
    hasProminentPersonFraming(photo)
  ) {
    subjects.add("outfit");
  }
  meaningfulObjects(photo).forEach((object) => subjects.add(normalizeSubject(object)));
  if (!subjects.size) {
    if (photo.photoType === "selfie" && hasSelfieFraming(photo, faceCount)) subjects.add("selfie");
    else subjects.add(photo.photoType === "random" ? "unknown" : photo.photoType);
  }
  return subjects;
}

function locationSimilarity(a: SemanticMetadata, b: SemanticMetadata) {
  if (a.locationType === "unknown" || b.locationType === "unknown") return 0.25;
  if (a.locationType === b.locationType)
    return clamp(0.65 + Math.min(a.locationConfidence, b.locationConfidence) * 0.35);
  if (sameLocationFamily(a.locationType, b.locationType)) return 0.55;
  return 0.05;
}

function sameLocationFamily(a: string, b: string) {
  const coastal = new Set(["beach", "ocean", "pool"]);
  const urban = new Set(["city", "street", "restaurant", "hotel", "airport"]);
  const nature = new Set(["park", "nature", "mountains"]);
  return [coastal, urban, nature].some((family) => family.has(a) && family.has(b));
}

function subjectSimilarity(a: SemanticMetadata, b: SemanticMetadata) {
  return jaccard(a.primarySubjects, b.primarySubjects);
}

function peopleSimilarity(a: SemanticMetadata, b: SemanticMetadata) {
  if (a.faceCount === 0 && b.faceCount === 0) return 0.55;
  if (a.faceCount === b.faceCount) return 1;
  return clamp(1 - Math.abs(a.faceCount - b.faceCount) / 4);
}

function colorSimilarity(a: SemanticMetadata, b: SemanticMetadata) {
  return jaccard(new Set(a.dominantColors), new Set(b.dominantColors));
}

function lightingSimilarity(a: Photo, b: Photo) {
  const brightness = 1 - Math.min(1, Math.abs(a.analysis.brightness - b.analysis.brightness) * 2);
  const warmth = 1 - Math.min(1, Math.abs(a.analysis.warmth - b.analysis.warmth) * 2);
  return clamp(brightness * 0.55 + warmth * 0.45);
}

function timeSignal(a: Photo, b: Photo) {
  const distance = timeDistance(a, b);
  if (!Number.isFinite(distance)) return { score: 0.08, reason: "" };
  if (distance <= 1000 * 60 * 3) return { score: 1, reason: "captured within 3 minutes" };
  if (distance <= 1000 * 60 * 10) return { score: 0.88, reason: "captured within 10 minutes" };
  if (distance <= 1000 * 60 * 60) return { score: 0.68, reason: "captured within an hour" };
  if (distance <= 1000 * 60 * 60 * 4) return { score: 0.42, reason: "captured the same day" };
  return { score: 0, reason: "" };
}

function isTravelEvent(event: EventGroup, metadata: Map<string, SemanticMetadata>) {
  return event.photos.some((photo) => {
    const location = metadata.get(photo.id)?.locationType;
    return ["beach", "city", "mountains", "airport", "hotel", "nature"].includes(location ?? "");
  });
}

function isTripCollection(events: EventGroup[], metadata: Map<string, SemanticMetadata>) {
  return events.length > 1 && events.some((event) => isTravelEvent(event, metadata));
}

function subjectCounts(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  const counts = new Map<string, number>();
  photos.forEach((photo) => {
    metadata.get(photo.id)?.primarySubjects.forEach((subject) => {
      if (subject !== "unknown") counts.set(subject, (counts.get(subject) ?? 0) + 1);
    });
  });
  return counts;
}

function locationCounts(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  const counts = new Map<string, number>();
  photos.forEach((photo) => {
    const location = metadata.get(photo.id)?.locationType ?? "unknown";
    if (location !== "unknown") counts.set(location, (counts.get(location) ?? 0) + 1);
  });
  return counts;
}

function topEntry(counts: Map<string, number>) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
}

function maxFaceCount(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  return Math.max(0, ...photos.map((photo) => metadata.get(photo.id)?.faceCount ?? 0));
}

function evidenceRatio(
  photos: Photo[],
  metadata: Map<string, SemanticMetadata>,
  predicate: (metadata: SemanticMetadata) => boolean,
) {
  if (!photos.length) return 0;
  const matches = photos.filter((photo) => {
    const meta = metadata.get(photo.id);
    return meta ? predicate(meta) : false;
  }).length;
  return matches / photos.length;
}

function neutralPeopleTitle(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  const faceCount = maxFaceCount(photos, metadata);
  if (faceCount >= 4) return "Group Photos";
  if (faceCount === 3) return "Three-Person Photos";
  if (faceCount === 2) return "Two-Person Photos";
  if (faceCount === 1) return "Solo Portraits";
  return "People Photos";
}

function hasLocation(photos: Photo[], metadata: Map<string, SemanticMetadata>, location: string) {
  return photos.some((photo) => metadata.get(photo.id)?.locationType === location);
}

function petTitle(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  const subjects = subjectCounts(photos, metadata);
  if ((subjects.get("cats") ?? 0) >= (subjects.get("dogs") ?? 0)) return "Cat Portraits";
  return "Dog Photos";
}

function isSunsetEvent(photos: Photo[]) {
  return photos.some((photo) => {
    const scene =
      `${photo.sceneAnalysis?.primaryScene ?? ""} ${photo.sceneAnalysis?.secondaryScene ?? ""}`.toLowerCase();
    return (
      scene.includes("sunset") ||
      scene.includes("golden hour") ||
      (photo.analysis.warmth > 0.58 &&
        photo.analysis.brightness > 0.28 &&
        photo.analysis.brightness < 0.76)
    );
  });
}

function commonLocation(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  const top = topEntry(locationCounts(photos, metadata));
  if (!top) return undefined;
  return top[1] >= Math.ceil(photos.length * 0.7) ? top[0] : undefined;
}

function hasProminentPersonFraming(photo: Photo) {
  const boxes = photo.analysis.peopleBoxes?.length
    ? photo.analysis.peopleBoxes
    : (photo.analysis.faceBoxes ?? []);
  if (!boxes.length) return false;
  const imageArea = Math.max(1, photo.width * photo.height);
  const largestArea = Math.max(...boxes.map((box) => box.w * box.h));
  const largestRatio = largestArea / imageArea;
  const portraitish = photo.height >= photo.width * 1.05;
  return largestRatio >= 0.08 || (portraitish && largestRatio >= 0.045);
}

function hasSelfieFraming(photo: Photo, faceCount: number) {
  if (faceCount <= 0) return false;
  const boxes = photo.analysis.faceBoxes ?? [];
  if (!boxes.length) return photo.photoType === "selfie" && photo.photoTypeConfidence >= 0.72;
  const imageArea = Math.max(1, photo.width * photo.height);
  const faceArea = boxes.reduce((sum, box) => sum + box.w * box.h, 0) / imageArea;
  const closeLargest = Math.max(...boxes.map((box) => box.w * box.h)) / imageArea;
  return (
    (photo.photoType === "selfie" && photo.photoTypeConfidence >= 0.65 && faceArea >= 0.08) ||
    faceArea >= 0.16 ||
    closeLargest >= 0.12
  );
}

function peopleCountDistribution(photos: Photo[], metadata: Map<string, SemanticMetadata>) {
  const counts = new Map<string, number>();
  photos.forEach((photo) => {
    const count = String(metadata.get(photo.id)?.faceCount ?? 0);
    counts.set(count, (counts.get(count) ?? 0) + 1);
  });
  return Object.fromEntries(counts);
}

function eventSubjectSet(event: EventGroup, metadata: Map<string, SemanticMetadata>) {
  const subjects = new Set<string>();
  event.photos.forEach((photo) => {
    metadata.get(photo.id)?.primarySubjects.forEach((subject) => subjects.add(subject));
  });
  return subjects;
}

function collectionConfidence(events: EventGroup[], metadata: Map<string, SemanticMetadata>) {
  if (events.length === 1) return events[0].confidence;
  const values: number[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      values.push(collectionAffinity([events[i]], events[j], metadata));
    }
  }
  return average(values);
}

function groupConfidence(
  photos: Photo[],
  metadata: Map<string, SemanticMetadata>,
  score: (a: Photo, b: Photo, metadata: Map<string, SemanticMetadata>) => PairSignal,
) {
  const values: number[] = [];
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      values.push(score(photos[i], photos[j], metadata).score);
    }
  }
  return values.length ? average(values) : 1;
}

function eventSummary(event: EventGroup): EventAnalysis {
  const { photos: _photos, confidence: _confidence, explanation: _explanation, ...summary } = event;
  return summary;
}

function collectionSummary(collection: CollectionGroup): CollectionAnalysis {
  const {
    events: _events,
    photos: _photos,
    confidence: _confidence,
    explanation: _explanation,
    ...summary
  } = collection;
  return summary;
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
  return jaccard(aLabels, bLabels);
}

function activeLabels(photo: Photo) {
  const labels = photo.sceneAnalysis?.labels;
  if (!labels) return new Set<string>();
  return new Set((Object.keys(labels) as (keyof typeof labels)[]).filter((key) => labels[key]));
}

function objectOverlap(a: Photo, b: Photo) {
  return jaccard(new Set(meaningfulObjects(a)), new Set(meaningfulObjects(b)));
}

function meaningfulObjects(photo: Photo) {
  return (photo.detectedObjects ?? [])
    .filter((object) => object.confidence >= 0.45)
    .map((object) => normalizeSubject(object.labelNormalized))
    .filter((label) => label && isSpecificObjectLabel(label));
}

function normalizeSubject(label: string) {
  const value = label.toLowerCase().trim();
  if (/cat|kitten/.test(value)) return "cats";
  if (/dog|puppy/.test(value)) return "dogs";
  if (/pet|animal/.test(value)) return "pets";
  if (/food|pizza|dessert|plate|meal|burger|sandwich/.test(value)) return "food";
  if (/drink|coffee|cocktail|wine|beer/.test(value)) return "drink";
  if (/building|architecture|church|house|facade/.test(value)) return "architecture";
  if (/car|bus|train|plane|airplane|vehicle/.test(value)) return "vehicles";
  if (/dress|shoe|bag|clothing|jewelry/.test(value)) return "outfit";
  if (/screen|text|document|receipt|button/.test(value)) return value;
  return value;
}

function isSpecificObjectLabel(label: string) {
  const ignored = new Set([
    "person",
    "people",
    "human",
    "face",
    "sky",
    "outdoor",
    "indoor",
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

function dominantColors(photo: Photo) {
  const colors = new Set<string>();
  const { avgR, avgG, avgB, warmth, saturation, brightness } = photo.analysis;
  if (brightness < 0.24) colors.add("dark");
  if (brightness > 0.76) colors.add("bright");
  if (warmth > 0.58) colors.add("warm");
  if (warmth < 0.35) colors.add("cool");
  if (saturation > 0.58) colors.add("colorful");
  if (avgB > avgR + 0.08 && avgB > avgG + 0.04) colors.add("blue");
  if (avgG > avgR + 0.08 && avgG > avgB + 0.02) colors.add("green");
  if (avgR > avgB + 0.08 && avgR > avgG + 0.02) colors.add("red");
  return [...colors];
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

function averageCrossScore(a: Photo[], b: Photo[], score: (left: Photo, right: Photo) => number) {
  const values: number[] = [];
  a.forEach((left) => b.forEach((right) => values.push(score(left, right))));
  return average(values);
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 0;
  const shared = [...a].filter((value) => b.has(value)).length;
  return shared / (new Set([...a, ...b]).size || 1);
}

function timeSpanMs(photos: Photo[]) {
  const times = photos.map((photo) => photo.lastModified).filter(Boolean) as number[];
  if (times.length < 2) return Number.POSITIVE_INFINITY;
  return Math.max(...times) - Math.min(...times);
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
  const aTimes = a.photos.map((photo) => photo.lastModified).filter(Boolean) as number[];
  const bTimes = b.photos.map((photo) => photo.lastModified).filter(Boolean) as number[];
  if (!aTimes.length || !bTimes.length) return Number.POSITIVE_INFINITY;
  const aMid = (Math.min(...aTimes) + Math.max(...aTimes)) / 2;
  const bMid = (Math.min(...bTimes) + Math.max(...bTimes)) / 2;
  return Math.abs(aMid - bMid);
}

function timeRange(photos: Photo[]) {
  const times = photos.map((photo) => photo.lastModified).filter(Boolean) as number[];
  if (!times.length) return undefined;
  const start = new Date(Math.min(...times)).toLocaleDateString();
  const end = new Date(Math.max(...times)).toLocaleDateString();
  return start === end ? start : `${start} - ${end}`;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * percentileValue)),
  );
  return sorted[index];
}

function rankingScore(photo: Photo) {
  return photo.ranking?.overallScore ?? photo.overall;
}

function find(parent: number[], index: number): number {
  if (parent[index] !== index) parent[index] = find(parent, parent[index]);
  return parent[index];
}

function union(parent: number[], a: number, b: number) {
  const rootA = find(parent, a);
  const rootB = find(parent, b);
  if (rootA !== rootB) parent[rootB] = rootA;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function prettyLocation(value: string) {
  if (value === "ocean") return "Ocean";
  return value.replace(/[_-]+/g, " ");
}

function prettySubject(value: string) {
  return value.replace(/[_-]+/g, " ");
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
