import type { Photo, UploadItem } from "./types";

export type TaglineInput = {
  items: UploadItem[];
  photos: Photo[];
  phase: "loading" | "local-scanning" | "refining" | "ready" | "preparing" | "blocked";
  tick: number;
  recent?: string[];
};

type Theme =
  | "beach"
  | "sunset"
  | "friends"
  | "couples"
  | "family"
  | "fashion"
  | "food"
  | "travel"
  | "city"
  | "nature"
  | "pets"
  | "sports"
  | "concert"
  | "party"
  | "celebration"
  | "landscape"
  | "architecture"
  | "everyday"
  | "mixed";

const TAGLINES: Record<Theme, string[]> = {
  beach: [
    "The beach really understood the assignment.",
    "The ocean is getting a lot of screen time today!",
    "Finding the best salt-air moments.",
    "This camera roll came with a sea breeze.",
    "Sorting through the sun, sand, and main-character energy.",
    "The beach photos are making a strong case.",
    "Keeping an eye on those shoreline favorites.",
    "Collecting the photos that feel like vacation.",
  ],
  sunset: [
    "Okayyyyy what a golden hour glow!!!",
    "Looks like the sunset put on a show.",
    "Collecting memories one sunset at a time.",
    "Golden hour really clocked in for this batch.",
    "Finding the warmest little glow moments.",
    "The sky had range today.",
    "Sorting the soft-light favorites.",
    "Some of these sunset shots are doing the most, respectfully.",
  ],
  friends: [
    "Some seriously photogenic moments in here.",
    "The group chat is looking very postable.",
    "Finding the photos that feel like the story.",
    "The friend photos are bringing the good energy.",
    "Main characters for a minute.",
    "Sorting the laugh-before-the-photo moments.",
    "This batch has very good people energy.",
    "Looking for the keepers your friends will ask you to send.",
  ],
  couples: [
    "Soft-launch energy detected.",
    "Finding the sweet little two-person moments.",
    "These paired-up photos have a nice little glow.",
    "Sorting the photos that feel quietly cute.",
    "Keeping an eye on the together moments.",
    "A few of these have rom-com still energy.",
    "Looking for the warmest couple-ish favorites.",
    "This camera roll has some very sweet chapters.",
  ],
  family: [
    "Finding the photos your future self will thank you for.",
    "This batch has keeper-memory energy.",
    "Looking for the little moments that age well.",
    "Sorting the photos that feel like home.",
    "Tiny memories are making a strong case.",
    "Finding the warmest family-frame favorites.",
    "This camera roll has some real keepsake potential.",
    "Saving room for the soft, important ones.",
  ],
  fashion: [
    "These outfits deserve their own mood board!",
    "Outfit documentation is looking strong.",
    "Finding the fit pics with the best light.",
    "This camera roll has a very clear sense of style.",
    "Sorting the looks that deserve the grid.",
    "The outfit photos came prepared.",
    "Can’t help but appreciate the outfit documentation!",
    "Looking for the most polished little style moments.",
  ],
  food: [
    "Snack content detected, standards immediately raised...",
    "The food photos are making a convincing argument.",
    "Finding the bites that deserve a spot.",
    "Camera eats first, DumpDeck sorts second.",
    "This batch has excellent menu energy.",
    "Sorting the plates, cups, and tiny treats.",
    "Some delicious little details in here.",
    "The drink documentation is very appreciated.",
  ],
  travel: [
    "This trip produced way too many good options.",
    "Sorting through the passport-stamp energy.",
    "Finding the photos that feel like a postcard.",
    "This camera roll has out-of-office energy.",
    "Travel documentation is looking very strong.",
    "Finding the little proof-we-went-there moments.",
    "The itinerary gave us options.",
    "Trying very hard not to keep the whole trip.",
  ],
  city: [
    "The city shots have a cool little rhythm.",
    "Finding the street-corner favorites.",
    "This camera roll has excellent city energy.",
    "Sorting the buildings, lights, and little walks.",
    "A few of these look like album covers.",
    "The city really showed up in this batch.",
    "Finding the best concrete-and-sky moments.",
    "This batch has a nice urban sparkle.",
  ],
  nature: [
    "The nature photos are looking peaceful in the best way.",
    "Finding the green little gems.",
    "This camera roll got some fresh air.",
    "Sorting the trees, trails, and tiny details.",
    "The outdoors really came through here.",
    "Looking for the calmest keeper moments.",
    "This batch has beautiful outside energy.",
    "Finding the photos that feel like a deep breath.",
  ],
  pets: [
    "Pet content detected, standards immediately raised...",
    "The pet photos are making this a very serious review.",
    "Finding the tiny celebrity moments.",
    "This camera roll has excellent companion energy.",
    "Sorting the paws, poses, and perfect little faces.",
    "The pet documentation is deeply appreciated.",
    "A few furry VIPs have entered the chat.",
    "Trying not to let the pet photos win everything.",
  ],
  sports: [
    "Sports content detected, keeping the action shots sharp.",
    "Finding the photos with the best game-day energy.",
    "Sorting the movement, focus, and big-moment frames.",
    "This batch has a little highlight-reel potential.",
    "Looking for the action shots that landed.",
    "The sporty moments are bringing momentum.",
    "Finding the best motion-without-the-blur moments.",
    "Game-day documentation is in progress.",
  ],
  concert: [
    "Concert lighting is always dramatic, and we respect it.",
    "Finding the best live-music glow.",
    "Sorting the lights, stage, and sing-along moments.",
    "This camera roll has very good night-out energy.",
    "Looking for the least-blurry iconic moments.",
    "Ranking the blurry-but-iconic memories.",
    "The concert photos came with atmosphere.",
    "Finding the photos that sound loud somehow.",
  ],
  party: [
    "This batch has a fun little night-out storyline.",
    "Finding the photos with the best party energy.",
    "Sorting the sparkle, friends, and tiny chaos.",
    "The camera roll had plans, clearly.",
    "Looking for the celebratory keepers.",
    "This group understood the assignment.",
    "Finding the photos that feel like the best part of the night.",
    "Trying very hard not to keep all the fun ones.",
  ],
  celebration: [
    "Celebration content detected, keeping the good stuff close.",
    "Finding the photos that feel like the occasion.",
    "Sorting the little hooray moments.",
    "This batch has something-to-toast energy.",
    "Looking for the sweetest celebration frames.",
    "The special-occasion photos are showing up.",
    "Finding the photos that feel most worth remembering.",
    "A few of these have instant keepsake energy.",
  ],
  landscape: [
    "The landscapes are quietly showing off.",
    "Finding the wide shots with the best mood.",
    "This camera roll has such a cool eye for photos...",
    "Sorting the views that deserve extra space.",
    "The scenery is doing a lot of heavy lifting here.",
    "Looking for the photos that feel cinematic.",
    "These views are making the cut difficult.",
    "Finding the best big-sky moments.",
  ],
  architecture: [
    "The architecture details are looking very intentional.",
    "Finding the lines, corners, and cool little frames.",
    "This batch has strong design appreciation.",
    "Sorting the buildings that deserve a closer look.",
    "Can’t help but appreciate the architecture documentation!",
    "The structures are giving the camera roll some edge.",
    "Finding the most satisfying composition moments.",
    "A few of these look like they belong in a travel guide.",
  ],
  everyday: [
    "There are some hidden gems in here...",
    "Finding the little life lately moments.",
    "This camera roll has impeccable vibes.",
    "Sorting the ordinary-but-good stuff.",
    "Some favorites are hiding in the quiet photos.",
    "Looking for the tiny moments that make the dump.",
    "This batch has a very good eye for small things.",
    "Finding the photos your future self will thank you for.",
  ],
  mixed: [
    "Trying very hard not to keep all of them...",
    "This camera roll has range.",
    "Finding the keepers without losing the story.",
    "A little bit of everything, exactly as a dump should be.",
    "Sorting the chaos into something cute.",
    "This batch has impeccable vibes.",
    "Looking for the hidden gems and obvious favorites.",
    "Finding the photos that make the whole thing feel effortless.",
  ],
};

const THEME_ORDER: Theme[] = [
  "beach",
  "sunset",
  "friends",
  "couples",
  "family",
  "fashion",
  "food",
  "travel",
  "city",
  "nature",
  "pets",
  "sports",
  "concert",
  "party",
  "celebration",
  "landscape",
  "architecture",
  "everyday",
  "mixed",
];

const RECENT_LIMIT = 8;

export function nextAnalyzingTagline(input: TaglineInput): string {
  const profile = buildBatchProfile(input.items, input.photos);
  const themes = chooseThemes(profile, input.phase);
  const pool = themes.flatMap((theme) => TAGLINES[theme]);
  const usable = pool.filter((line) => !(input.recent ?? []).includes(line));
  const source = usable.length ? usable : pool.length ? pool : TAGLINES.mixed;
  const seed = seededValue(input.items, input.photos, input.tick);
  return source[seed % source.length] ?? TAGLINES.mixed[0];
}

export function rememberTagline(recent: string[], line: string): string[] {
  return [line, ...recent.filter((entry) => entry !== line)].slice(0, RECENT_LIMIT);
}

function buildBatchProfile(items: UploadItem[], photos: Photo[]) {
  const haystack = `${items.map((item) => item.name).join(" ")} ${photos
    .flatMap((photo) => [
      photo.photoType,
      photo.name,
      photo.sceneAnalysis?.primaryScene,
      photo.sceneAnalysis?.secondaryScene,
      ...photo.tags,
      ...(photo.detectedObjects ?? []).map((object) => object.labelNormalized),
    ])
    .join(" ")}`.toLowerCase();
  const labels = photos.map((photo) => photo.sceneAnalysis?.labels).filter(Boolean);
  const objects = new Set(
    photos.flatMap((photo) =>
      (photo.detectedObjects ?? []).map((object) => object.labelNormalized),
    ),
  );
  const peoplePhotos = photos.filter((photo) => photo.peopleCount > 0).length;
  const groupPhotos = photos.filter((photo) => photo.peopleCount >= 2).length;
  const foodPhotos = photos.filter((photo) => photo.photoType === "food").length;
  const landscapePhotos = photos.filter((photo) => photo.photoType === "landscape").length;
  const outfitPhotos = photos.filter((photo) => photo.tags.includes("Outfit")).length;
  const goldenPhotos = photos.filter((photo) => photo.tags.includes("Golden hour")).length;

  return {
    has: (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(haystack)),
    labelCount: (key: keyof NonNullable<(typeof labels)[number]>) =>
      labels.filter((label) => label?.[key]).length,
    objects,
    peoplePhotos,
    groupPhotos,
    foodPhotos,
    landscapePhotos,
    outfitPhotos,
    goldenPhotos,
    totalKnown: photos.length,
  };
}

function chooseThemes(
  profile: ReturnType<typeof buildBatchProfile>,
  phase: TaglineInput["phase"],
): Theme[] {
  const scores = new Map<Theme, number>();
  const add = (theme: Theme, score: number) => scores.set(theme, (scores.get(theme) ?? 0) + score);

  if (profile.goldenPhotos || profile.has([/sunset|sunrise|golden|dusk|twilight/])) {
    add("sunset", 8 + profile.goldenPhotos);
  }
  if (profile.labelCount("beach") || profile.has([/beach|ocean|sea|shore|coast|waves?/])) {
    add("beach", 8 + profile.labelCount("beach"));
  }
  if (profile.groupPhotos || profile.has([/friend|group|girls|guys|bestie|crew/])) {
    add("friends", 6 + profile.groupPhotos);
  }
  if (profile.has([/couple|date|anniversary|wedding|soft launch/])) add("couples", 7);
  if (profile.has([/family|mom|dad|sister|brother|cousin|grandma|grandpa/])) add("family", 7);
  if (profile.outfitPhotos || profile.has([/outfit|fit check|dress|fashion|mirror/])) {
    add("fashion", 6 + profile.outfitPhotos);
  }
  if (profile.foodPhotos || profile.labelCount("food") || hasAny(profile.objects, FOOD_OBJECTS)) {
    add("food", 7 + profile.foodPhotos + profile.labelCount("food"));
  }
  if (profile.has([/trip|travel|vacation|hotel|airport|train|road/])) add("travel", 7);
  if (profile.labelCount("city") || profile.has([/city|street|downtown|skyline|metro|urban/])) {
    add("city", 7 + profile.labelCount("city"));
  }
  if (profile.has([/forest|trail|garden|park|trees?|lake|river/])) add("nature", 7);
  if (profile.labelCount("pets") || hasAny(profile.objects, ["dog", "cat", "pet", "bird"])) {
    add("pets", 9 + profile.labelCount("pets"));
  }
  if (profile.labelCount("sports") || profile.has([/game|sport|tennis|soccer|baseball|golf/])) {
    add("sports", 7);
  }
  if (profile.has([/concert|festival|stage|music|band|dj/])) add("concert", 8);
  if (profile.has([/party|bar|club|night out|birthday/])) add("party", 7);
  if (profile.has([/birthday|graduation|celebration|wedding|toast/])) add("celebration", 7);
  if (
    profile.landscapePhotos ||
    profile.labelCount("landscape") ||
    profile.labelCount("mountains")
  ) {
    add("landscape", 6 + profile.landscapePhotos);
  }
  if (
    hasAny(profile.objects, ["building", "architecture"]) ||
    profile.has([/building|museum|church|house|architecture/])
  ) {
    add("architecture", 7);
  }
  if (profile.totalKnown > 0) add("everyday", 3);
  add("mixed", phase === "local-scanning" ? 5 : 2);

  const ranked = THEME_ORDER.filter((theme) => scores.has(theme)).sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0),
  );
  return ranked.slice(0, Math.max(3, Math.min(6, ranked.length)));
}

const FOOD_OBJECTS = ["food", "pizza", "cake", "sandwich", "plate", "bowl", "cup", "drink"];

function hasAny(values: Set<string>, candidates: string[]) {
  return candidates.some((candidate) => values.has(candidate));
}

function seededValue(items: UploadItem[], photos: Photo[], tick: number) {
  const base = `${items.length}:${photos.length}:${items[0]?.name ?? ""}:${photos[0]?.name ?? ""}`;
  let hash = tick * 2654435761;
  for (let index = 0; index < base.length; index++) {
    hash = Math.imul(hash ^ base.charCodeAt(index), 16777619);
  }
  return Math.abs(hash);
}
