import type {
  Analysis,
  Orientation,
  Photo,
  PhotoType,
  Scores,
  Settings,
  Tag,
  VibeFocus,
} from "./types";

const W = 48;
const H = 36;

export async function analyzeImage(url: string): Promise<Analysis> {
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("ctx");
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    let sumL = 0,
      sumL2 = 0,
      sumSat = 0,
      sumWarm = 0,
      skin = 0;
    let sumR = 0,
      sumG = 0,
      sumB = 0;
    const grays: number[] = [];
    const rs: number[] = [],
      gs: number[] = [],
      bs: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255,
        g = data[i + 1] / 255,
        b = data[i + 2] / 255;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1) || 1);
      sumL += l;
      sumL2 += l * l;
      sumSat += s;
      sumWarm += r - b;
      sumR += r;
      sumG += g;
      sumB += b;
      if (r > 0.35 && r > g && r > b && r - b > 0.05 && r - g < 0.4 && g > 0.2) skin++;
      grays.push(l);
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
    const n = data.length / 4;
    const brightness = clamp(sumL / n);
    const variance = sumL2 / n - brightness * brightness;
    const contrast = clamp(Math.sqrt(Math.max(0, variance)) * 2.4);
    const saturation = clamp(sumSat / n);
    const warmth = clamp((sumWarm / n) * 2, -1, 1);
    const faceish = clamp(skin / n);
    const avgR = sumR / n,
      avgG = sumG / n,
      avgB = sumB / n;
    const sharpness = laplacianVariance(grays, W, H);

    const aHashHex = aHash(grays, W, H);
    const dHashHex = dHash(grays, W, H);
    const feature = featureVector(grays, rs, gs, bs, W, H);

    return {
      brightness,
      contrast,
      saturation,
      warmth,
      aHash: aHashHex,
      dHash: dHashHex,
      feature,
      avgR,
      avgG,
      avgB,
      faceish,
      sharpness,
      detectedPeopleCount: -1,
      detectedFaceCount: -1,
      detectionConfidence: 0,
      peopleUnsure: true,
    };
  } catch {
    return {
      brightness: 0.5,
      contrast: 0.5,
      saturation: 0.5,
      warmth: 0,
      aHash: "0000000000000000",
      dHash: "0000000000000000",
      feature: new Array(192 + 48 + 36).fill(0),
      avgR: 0.5,
      avgG: 0.5,
      avgB: 0.5,
      faceish: 0,
      sharpness: 0.3,
      detectedPeopleCount: -1,
      detectedFaceCount: -1,
      detectionConfidence: 0,
      peopleUnsure: true,
    };
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
}

function clamp(n: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n));
}

function aHash(grays: number[], w: number, h: number) {
  const block = downsample(grays, w, h, 8, 8);
  const mean = block.reduce((a, b) => a + b, 0) / 64;
  return bitsToHex(block.map((v) => (v >= mean ? "1" : "0")).join(""));
}

function dHash(grays: number[], w: number, h: number) {
  const block = downsample(grays, w, h, 9, 8);
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += block[y * 9 + x] > block[y * 9 + x + 1] ? "1" : "0";
    }
  }
  return bitsToHex(bits);
}

function downsample(src: number[], w: number, h: number, bw: number, bh: number) {
  const out: number[] = [];
  const cw = w / bw,
    ch = h / bh;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let s = 0,
        c = 0;
      const y0 = Math.floor(by * ch),
        y1 = Math.max(y0 + 1, Math.floor((by + 1) * ch));
      const x0 = Math.floor(bx * cw),
        x1 = Math.max(x0 + 1, Math.floor((bx + 1) * cw));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          s += src[y * w + x];
          c++;
        }
      }
      out.push(s / Math.max(1, c));
    }
  }
  return out;
}

function bitsToHex(bits: string) {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

function featureVector(g: number[], r: number[], gg: number[], b: number[], w: number, h: number) {
  const gray = downsample(g, w, h, 16, 12);
  const rv = downsample(r, w, h, 4, 4);
  const gv = downsample(gg, w, h, 4, 4);
  const bv = downsample(b, w, h, 4, 4);
  const hist = [...histogram(r, 12), ...histogram(gg, 12), ...histogram(b, 12)];
  return [...gray, ...rv, ...gv, ...bv, ...hist];
}

function histogram(values: number[], bins: number) {
  const out = new Array(bins).fill(0);
  for (const v of values) out[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
  return out.map((x) => x / Math.max(1, values.length));
}

function laplacianVariance(g: number[], w: number, h: number) {
  let s = 0,
    s2 = 0,
    n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = g[y * w + x];
      const avg =
        (g[(y - 1) * w + x] + g[(y + 1) * w + x] + g[y * w + x - 1] + g[y * w + x + 1]) / 4;
      const d = c - avg;
      s += d;
      s2 += d * d;
      n++;
    }
  }
  const m = s / n;
  const v = s2 / n - m * m;
  return clamp(Math.sqrt(Math.max(0, v)) * 6);
}

export function hammingDistance(a: string, b: string) {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function cosineDistance(a: number[], b: number[]) {
  if (a.length !== b.length) return 2;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 2;
  return 1 - dot / denom;
}

export function classifyPhoto(
  width: number,
  height: number,
  a: Analysis,
): {
  photoType: PhotoType;
  photoTypeConfidence: number;
  peopleCount: 0 | 1 | 2 | 3 | 4;
  peopleConfidence: number;
  orientation: Orientation;
  peopleUnsure: boolean;
} {
  const ratio = width / Math.max(1, height);
  const orientation: Orientation = ratio > 1.1 ? "landscape" : ratio < 0.92 ? "portrait" : "square";

  const f = a.faceish;
  const hasDetection = a.detectedPeopleCount >= 0 || a.detectedFaceCount >= 0;

  let peopleCount: 0 | 1 | 2 | 3 | 4;
  let peopleConfidence: number;
  let peopleUnsure = a.peopleUnsure;

  if (hasDetection) {
    const ppl = Math.max(0, a.detectedPeopleCount);
    const fac = Math.max(0, a.detectedFaceCount);
    const combined = Math.max(ppl, fac);
    peopleCount = Math.min(4, combined) as 0 | 1 | 2 | 3 | 4;
    peopleConfidence = a.detectionConfidence;
    if (!peopleUnsure) {
      peopleUnsure =
        a.detectedPeopleCount >= 0 && a.detectedFaceCount >= 0 ? Math.abs(ppl - fac) > 1 : true;
    }
  } else {
    if (f >= 0.4) peopleCount = 4;
    else if (f >= 0.28) peopleCount = 3;
    else if (f >= 0.16) peopleCount = 2;
    else if (f >= 0.06) peopleCount = 1;
    else peopleCount = 0;
    const nearestEdge = Math.min(...[0.06, 0.16, 0.28, 0.4].map((t) => Math.abs(f - t)));
    peopleConfidence = clamp(nearestEdge * 4);
    peopleUnsure = true;
  }

  const greenDom = a.avgG - (a.avgR + a.avgB) / 2;
  const blueDom = a.avgB - (a.avgR + a.avgG) / 2;
  const redWarmDom = a.avgR - a.avgB;

  let photoType: PhotoType = "random";
  let photoTypeConfidence = 0.35;

  const trustPeople = !peopleUnsure && peopleConfidence >= 0.6;

  if (trustPeople && peopleCount >= 3) {
    photoType = "group";
    photoTypeConfidence = clamp(0.6 + peopleConfidence * 0.3);
  } else if (trustPeople && peopleCount >= 1) {
    if (orientation === "landscape" && peopleCount >= 2) {
      photoType = "group";
      photoTypeConfidence = clamp(0.55 + peopleConfidence * 0.3);
    } else {
      photoType = "selfie";
      photoTypeConfidence = clamp(0.5 + peopleConfidence * 0.3);
    }
  } else if (
    trustPeople &&
    peopleCount === 0 &&
    (greenDom > 0.06 || blueDom > 0.06) &&
    orientation !== "portrait"
  ) {
    photoType = "landscape";
    photoTypeConfidence = clamp(0.55 + Math.max(greenDom, blueDom) * 4);
  } else if (
    trustPeople &&
    peopleCount === 0 &&
    redWarmDom > 0.07 &&
    a.saturation > 0.4 &&
    a.brightness > 0.32 &&
    a.brightness < 0.82
  ) {
    photoType = "food";
    photoTypeConfidence = clamp(0.5 + redWarmDom * 3);
  } else if (
    trustPeople &&
    peopleCount === 0 &&
    orientation === "portrait" &&
    a.contrast > 0.32 &&
    a.sharpness > 0.3
  ) {
    photoType = "outfit";
    photoTypeConfidence = 0.45;
  } else if (trustPeople && peopleCount === 0 && a.contrast > 0.5 && a.sharpness > 0.4) {
    photoType = "detail";
    photoTypeConfidence = 0.5;
  }

  return {
    photoType,
    photoTypeConfidence,
    peopleCount,
    peopleConfidence,
    orientation,
    peopleUnsure,
  };
}

export function scorePhoto(
  input: { width: number; height: number; analysis: Analysis },
  classification: {
    photoType: PhotoType;
    photoTypeConfidence: number;
    peopleCount: number;
    peopleConfidence: number;
    orientation: Orientation;
    peopleUnsure?: boolean;
  },
  settings: Settings,
): { scores: Scores; overall: number; tags: Tag[]; reasons: string[] } {
  const a = input.analysis;

  const brightnessPenalty = 1 - Math.abs(a.brightness - 0.55) * 1.8;
  const lighting = clamp(brightnessPenalty * 0.55 + a.contrast * 0.3 + a.sharpness * 0.15);
  const aesthetic = clamp(
    a.contrast * 0.4 +
      a.saturation * 0.25 +
      (1 - Math.abs(a.brightness - 0.5)) * 0.2 +
      a.sharpness * 0.15,
  );
  const quality = clamp(a.sharpness * 0.55 + a.contrast * 0.3 + (a.brightness > 0.15 ? 0.15 : 0));

  const detectionPeople =
    a.detectedPeopleCount >= 0 || a.detectedFaceCount >= 0
      ? Math.max(0, Math.max(a.detectedPeopleCount, a.detectedFaceCount))
      : -1;
  const peopleScore = detectionPeople >= 0 ? clamp(detectionPeople / 4) : clamp(a.faceish * 4);

  const fun = clamp(a.saturation * 0.4 + peopleScore * 0.35 + a.contrast * 0.25);
  const unique = 0.7;

  const w = vibeWeights(settings.vibes, classification.photoType);
  const postWorthy = clamp(
    aesthetic * w.aesthetic +
      fun * w.fun +
      peopleScore * w.people +
      w.typeBonus * 0.4 +
      lighting * 0.1,
  );

  const formatBonus = formatMatch(input.width / Math.max(1, input.height), settings.formats);
  const scores: Scores = { aesthetic, fun, postWorthy, unique, quality, lighting };
  const overall = clamp(
    aesthetic * 0.22 +
      fun * 0.12 +
      postWorthy * 0.28 +
      quality * 0.15 +
      lighting * 0.13 +
      formatBonus * 0.1,
  );

  const tags: Tag[] = [];
  const reasons: string[] = [];

  if (lighting > 0.72 && a.brightness > 0.45 && a.brightness < 0.78) {
    tags.push("Best lighting");
    reasons.push("Balanced brightness, strong contrast and detail.");
  }
  if (a.warmth > 0.2 && a.brightness > 0.4 && a.brightness < 0.78) tags.push("Golden hour");
  if (a.contrast > 0.58 && a.saturation > 0.5) tags.push("Punchy color");
  if (a.contrast < 0.3 && a.saturation < 0.32) tags.push("Soft & moody");

  const unsure = !!classification.peopleUnsure;
  const peopleHigh = !unsure && classification.peopleConfidence >= 0.6;

  const typeTag: Record<PhotoType, Tag> = {
    selfie: "Selfie",
    group: "Group",
    food: "Food",
    landscape: "Landscape",
    outfit: "Outfit",
    detail: "Detail",
    random: "Random",
  };

  if (classification.photoType === "selfie" || classification.photoType === "group") {
    if (peopleHigh && classification.photoTypeConfidence >= 0.55) {
      tags.push(typeTag[classification.photoType]);
    } else if (unsure) {
      tags.push("Unsure");
      reasons.push("People count was uncertain — models disagreed.");
    }
  } else if (classification.photoTypeConfidence >= 0.55) {
    tags.push(typeTag[classification.photoType]);
  } else if (classification.photoType !== "random") {
    tags.push("Unsure");
  }

  if (classification.orientation === "landscape") tags.push("Wide shot");
  if (classification.orientation === "portrait" && classification.photoType === "detail")
    tags.push("Close up");

  if (postWorthy > 0.78 && peopleHigh && classification.peopleCount >= 1) {
    tags.push("Main character");
  }

  if (
    settings.vibes.includes("funny") &&
    fun > 0.72 &&
    peopleHigh &&
    classification.peopleCount >= 1 &&
    a.saturation > 0.45
  ) {
    tags.push("Funny one");
    reasons.push("High color + people energy — fits your funny vibe.");
  }

  return { scores, overall, tags: dedupe(tags).slice(0, 3), reasons };
}

function dedupe<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function vibeWeights(vibes: VibeFocus[], type: PhotoType) {
  let aesthetic = 0,
    fun = 0,
    people = 0,
    typeBonus = 0;
  const list = vibes.length ? vibes : (["random"] as VibeFocus[]);
  for (const v of list) {
    switch (v) {
      case "aesthetic":
        aesthetic += 1;
        if (type === "landscape" || type === "detail" || type === "outfit") typeBonus += 1;
        break;
      case "cute":
        people += 0.6;
        aesthetic += 0.4;
        if (type === "selfie" || type === "group") typeBonus += 0.8;
        break;
      case "funny":
        fun += 1;
        if (type === "selfie" || type === "group" || type === "random") typeBonus += 0.7;
        break;
      case "vacation":
        aesthetic += 0.6;
        people += 0.4;
        if (type === "landscape" || type === "group" || type === "food") typeBonus += 1;
        break;
      case "food":
        aesthetic += 0.5;
        if (type === "food" || type === "detail") typeBonus += 1.2;
        break;
      case "friends":
        people += 1;
        if (type === "group" || type === "selfie") typeBonus += 1;
        break;
      case "random":
        aesthetic += 0.34;
        fun += 0.33;
        people += 0.33;
        typeBonus += 0.3;
        break;
    }
  }
  const total = Math.max(1, list.length);
  return {
    aesthetic: aesthetic / total,
    fun: fun / total,
    people: people / total,
    typeBonus: typeBonus / total,
  };
}

function formatMatch(ratio: number, formats: Settings["formats"]) {
  const targetFor = (f: string) =>
    f === "landscape" ? 1.91 : f === "story" ? 0.5625 : f === "square" ? 1 : 0.8;
  const list = formats.length ? formats : (["portrait"] as Settings["formats"]);
  let best = 0;
  for (const f of list) {
    const diff = Math.abs(ratio - targetFor(f));
    best = Math.max(best, clamp(1 - diff * 0.8));
  }
  return best;
}

export type SimilarGroup = { id: number; photos: Photo[]; kind: "near-dup" | "semantic" };

const NEAR_DUP_BITS = 7;
const SEMANTIC_COSINE = 0.032;
const SEMANTIC_AHASH_MAX = 15;

export function isNearDuplicate(a: Photo, b: Photo) {
  const dh = hammingDistance(a.analysis.dHash, b.analysis.dHash);
  const ah = hammingDistance(a.analysis.aHash, b.analysis.aHash);
  const palette = paletteDistance(a, b);
  const hist = histogramDistance(a, b);
  const cd = cosineDistance(a.analysis.feature, b.analysis.feature);
  if (dh <= NEAR_DUP_BITS && ah <= 14 && palette < 0.34) return true;
  if (cd <= 0.065 && hist < 0.56 && palette < 0.18 && Math.min(dh, ah) <= 30) return true;
  return false;
}

export function isSemanticallySimilar(a: Photo, b: Photo) {
  const cd = cosineDistance(a.analysis.feature, b.analysis.feature);
  if (cd > SEMANTIC_COSINE) return false;
  const ah = hammingDistance(a.analysis.aHash, b.analysis.aHash);
  if (ah > SEMANTIC_AHASH_MAX) return false;
  if (a.orientation !== b.orientation && a.photoType !== b.photoType) return false;
  if (a.photoType !== "random" && b.photoType !== "random" && a.photoType !== b.photoType)
    return false;
  return paletteDistance(a, b) < 0.24 && histogramDistance(a, b) < 0.12;
}

function paletteDistance(a: Photo, b: Photo) {
  return (
    Math.abs(a.analysis.avgR - b.analysis.avgR) +
    Math.abs(a.analysis.avgG - b.analysis.avgG) +
    Math.abs(a.analysis.avgB - b.analysis.avgB)
  );
}

function histogramDistance(a: Photo, b: Photo) {
  const start = Math.max(0, Math.min(a.analysis.feature.length, b.analysis.feature.length) - 36);
  let sum = 0;
  for (let i = start; i < a.analysis.feature.length && i < b.analysis.feature.length; i++) {
    sum += Math.abs(a.analysis.feature[i] - b.analysis.feature[i]);
  }
  return sum / 3;
}

export function groupNearDuplicates(photos: Photo[]): SimilarGroup[] {
  return cluster(photos, isNearDuplicate, "near-dup");
}

export function groupSemantic(photos: Photo[]): SimilarGroup[] {
  return cluster(photos, isSemanticallySimilar, "semantic");
}

function cluster(
  photos: Photo[],
  similar: (a: Photo, b: Photo) => boolean,
  kind: SimilarGroup["kind"],
): SimilarGroup[] {
  const groups: Photo[][] = [];
  for (const p of photos) {
    let placed = false;
    for (const g of groups) {
      const anchor = g[0];
      if (similar(p, anchor)) {
        g.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([p]);
  }
  return groups.map((arr, i) => ({
    id: i,
    kind,
    photos: arr.sort((a, b) => b.overall - a.overall),
  }));
}

export function buildSimilarStage(photos: Photo[]): {
  survivors: Photo[];
  semanticGroups: SimilarGroup[];
  removedNearDup: { kept: Photo; dropped: Photo[]; reason: string }[];
} {
  const dupGroups = groupNearDuplicates(photos);
  const survivors: Photo[] = [];
  const removedNearDup: { kept: Photo; dropped: Photo[]; reason: string }[] = [];
  for (const g of dupGroups) {
    const [best, ...rest] = g.photos;
    survivors.push(best);
    if (rest.length) {
      const reason =
        best.scores.lighting >= 0.6
          ? `Kept because it had better lighting & sharpness than ${rest.length} near-duplicate${rest.length === 1 ? "" : "s"}.`
          : `Kept because it had the highest overall score among ${rest.length + 1} near-duplicates.`;
      removedNearDup.push({ kept: best, dropped: rest, reason });
      if (!best.reasons.includes(reason)) best.reasons.push(reason);
    }
  }
  const semanticGroups = groupSemantic(survivors).map((g) => ({
    ...g,
    photos: g.photos.map((p, i) => {
      if (i > 0 && g.photos.length > 1) {
        if (!p.tags.includes("Too similar")) p.tags = [...p.tags, "Too similar"];
      }
      return p;
    }),
  }));
  semanticGroups.forEach((g) => g.photos.forEach((p) => (p.group = g.id)));
  return { survivors, semanticGroups, removedNearDup };
}

export function buildAllSimilarGroups(photos: Photo[]): SimilarGroup[] {
  const similar = (a: Photo, b: Photo) => isNearDuplicate(a, b) || isSemanticallySimilar(a, b);
  const groups: Photo[][] = [];
  for (const p of photos) {
    let placed = false;
    for (const g of groups) {
      if (similar(p, g[0])) {
        g.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([p]);
  }
  return groups.map((arr, i) => {
    const sorted = [...arr].sort((a, b) => b.overall - a.overall);
    const hasNearDup =
      sorted.length > 1 && sorted.some((q, idx) => idx > 0 && isNearDuplicate(sorted[0], q));
    return { id: i, kind: hasNearDup ? "near-dup" : "semantic", photos: sorted };
  });
}

export function groupBestBadges(photos: Photo[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (photos.length === 0) return out;
  photos.forEach((p) => (out[p.id] = []));
  const winner = (key: (p: Photo) => number, label: string) => {
    let best = photos[0],
      v = key(photos[0]);
    for (const p of photos) {
      const s = key(p);
      if (s > v) {
        v = s;
        best = p;
      }
    }
    if (!out[best.id].includes(label)) out[best.id].push(label);
  };
  winner((p) => p.scores.lighting, "Best lighting");
  winner((p) => p.analysis.sharpness, "Sharpest");
  winner((p) => p.analysis.faceish * 0.6 + p.scores.fun * 0.4, "Best expression");
  return out;
}

export function shortlist(photos: Photo[]): Photo[] {
  return [...photos].filter((p) => p.scores.quality > 0.18).sort((a, b) => b.overall - a.overall);
}

export function aiOrder(
  photos: Photo[],
  settings?: Settings,
  options: { pinnedCoverId?: string | null } = {},
): Photo[] {
  if (photos.length <= 2) return [...photos];
  const pool = [...photos];
  pool.sort((a, b) => rankingScore(b) - rankingScore(a));

  const wantsFunny = settings?.vibes.includes("funny");
  const wantsFriends = settings?.vibes.includes("friends") || settings?.vibes.includes("cute");

  const pinnedIndex = options.pinnedCoverId
    ? pool.findIndex((photo) => photo.id === options.pinnedCoverId)
    : -1;
  const first = pinnedIndex >= 0 ? pool.splice(pinnedIndex, 1)[0] : pool.shift()!;
  first.tags = dedupe([
    ...first.tags.filter((t) => t !== "Good filler slide" && t !== "Best ending"),
    "Good first slide",
  ]);

  const finale = wantsFunny
    ? bestBy(pool, (p) => p.scores.fun + (p.tags.includes("Funny one") ? 0.2 : 0))
    : wantsFriends
      ? bestBy(pool, (p) => peopleWeight(p) * 0.45 + rankingScore(p) * 0.55)
      : bestBy(pool, (p) => p.scores.aesthetic * 0.45 + rankingScore(p) * 0.55);
  if (finale) {
    pool.splice(pool.indexOf(finale), 1);
    finale.tags = dedupe([
      ...finale.tags.filter((t) => t !== "Good filler slide" && t !== "Good first slide"),
      "Best ending",
    ]);
  }

  const ordered: Photo[] = [first];
  while (pool.length) {
    const prev = ordered[ordered.length - 1];
    const prev2 = ordered[ordered.length - 2];
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      let penalty = 0;
      if (sceneKey(c) === sceneKey(prev)) penalty += 7;
      if (prev2 && sceneKey(c) === sceneKey(prev2)) penalty += 3;
      if (c.photoType === prev.photoType) penalty += 4;
      if (prev2 && c.photoType === prev2.photoType) penalty += 2.5;
      if (peopleWeight(c) > 0.35 && peopleWeight(prev) > 0.35) penalty += 5;
      if (prev2 && peopleWeight(c) > 0.35 && peopleWeight(prev2) > 0.35) penalty += 2;
      if (c.duplicateClusterId && c.duplicateClusterId === prev.duplicateClusterId) penalty += 8;
      const cd = cosineDistance(c.analysis.feature, prev.analysis.feature);
      if (cd < 0.05) penalty += 8;
      else if (cd < 0.1) penalty += 4;
      if (prev2) {
        const cd2 = cosineDistance(c.analysis.feature, prev2.analysis.feature);
        if (cd2 < 0.05) penalty += 3;
      }
      if (c.orientation === prev.orientation) penalty += 1.5;
      if (prev2 && c.orientation === prev.orientation && prev.orientation === prev2.orientation) {
        penalty += 3;
      }
      const recent = ordered.slice(-3);
      const recentPeople = recent.filter((p) => peopleWeight(p) > 0.35).length;
      const recentScene = recent.filter((p) => sceneKey(p) === sceneKey(c)).length;
      const recentType = recent.filter((p) => p.photoType === c.photoType).length;
      if (peopleWeight(c) > 0.35 && recentPeople >= 2) penalty += 4;
      if (recentScene >= 2) penalty += 3.5;
      if (recentType >= 2) penalty += 2.5;
      const scoreDrop = Math.max(0, rankingScore(prev) - rankingScore(c));
      penalty += scoreDrop * 1.1;
      penalty += i * 0.01;
      penalty += seededJitter(c.id, ordered.length) * 1.6;

      if (penalty < bestScore) {
        bestScore = penalty;
        bestIdx = i;
      }
    }
    const chosen = pool.splice(bestIdx, 1)[0];
    if (!chosen.tags.includes("Good first slide") && !chosen.tags.includes("Best ending")) {
      chosen.tags = dedupe([
        ...chosen.tags.filter((t) => t !== "Good filler slide"),
        "Good filler slide",
      ]);
    }
    ordered.push(chosen);
  }
  if (finale) ordered.push(finale);
  return ordered;
}

function seededJitter(id: string, slot: number) {
  let hash = slot + 17;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  }
  return hash / 9973 - 0.5;
}

function rankingScore(photo: Photo) {
  return (
    photo.unifiedAnalysis?.analysis.rankingScore ?? photo.ranking?.overallScore ?? photo.overall
  );
}

function peopleWeight(photo: Photo) {
  return Math.min(1, (photo.unifiedAnalysis?.analysis.peopleCount ?? photo.peopleCount) / 3);
}

function sceneKey(photo: Photo) {
  return (
    photo.unifiedAnalysis?.analysis.scene ?? photo.sceneAnalysis?.primaryScene ?? photo.photoType
  );
}

function bestBy<T>(arr: T[], score: (t: T) => number): T | undefined {
  if (!arr.length) return undefined;
  let best = arr[0],
    bestScore = score(arr[0]);
  for (let i = 1; i < arr.length; i++) {
    const s = score(arr[i]);
    if (s > bestScore) {
      best = arr[i];
      bestScore = s;
    }
  }
  return best;
}
