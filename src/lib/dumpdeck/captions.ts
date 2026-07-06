import type { Photo, VibeFocus } from "./types";

export type CaptionStyle =
  "aesthetic" | "funny" | "minimal" | "cute" | "hype" | "trendy" | "hashtags";

export type CaptionIdea = {
  style: CaptionStyle;
  label: string;
  text: string;
};

const BANK: Record<
  VibeFocus,
  {
    aesthetic: string[];
    funny: string[];
    cute: string[];
    minimal: string[];
    hype: string[];
    trendy: string[];
  }
> = {
  cute: {
    aesthetic: ["soft hours", "little things i liked", "kept the warm ones"],
    funny: ["unserious little moments", "a few from the cute folder"],
    cute: ["little joys from lately", "collecting moments like stickers", "tiny happy things"],
    minimal: ["softly", "little days", "kept these"],
    hype: ["core memories from lately", "keeping these close"],
    trendy: ["little life lately", "kept the good ones", "some favorites lately"],
  },
  aesthetic: {
    aesthetic: [
      "golden hour leftovers",
      "a quiet sequence",
      "film grain and feelings",
      "in no particular order",
    ],
    funny: ["the algorithm could never", "overthinking the camera roll"],
    cute: ["pretty little nothings", "made of light"],
    minimal: ["lately", "light study", "kept"],
    hype: ["scroll, stop, stare", "the pretty ones"],
    trendy: [
      "golden hour did its thing",
      "too good to stay in the camera roll",
      "kept the good ones",
    ],
  },
  funny: {
    aesthetic: ["chaos, but make it cute", "art? maybe. memories? definitely."],
    funny: [
      "no theme, just evidence",
      "camera roll said explain yourself",
      "somehow these made the cut",
    ],
    cute: ["silly little dump for silly little me"],
    minimal: ["little chaos", "noted", "posted"],
    hype: ["posting before i overthink it", "saving these from the camera roll"],
    trendy: [
      "proof we left the house",
      "camera roll made the cut",
      "the weekend, loosely documented",
    ],
  },
  vacation: {
    aesthetic: ["postcards i never sent", "out of office, into the light"],
    funny: ["went away, came back with these", "tanned, lost, fed"],
    cute: ["sun-soaked & sweet", "kept the salty ones"],
    minimal: ["away", "abroad", "sun"],
    hype: ["take me back immediately", "the trip dump you asked for"],
    trendy: [
      "golden hour did its thing",
      "the weekend, loosely documented",
      "too good to stay in the camera roll",
    ],
  },
  food: {
    aesthetic: ["a small menu of joy", "plates & places"],
    funny: ["ate everything, regret nothing", "this is a personality trait"],
    cute: ["snacks make me soft"],
    minimal: ["bites", "menu", "fed"],
    hype: ["the food chapter", "saving this meal forever"],
    trendy: ["camera roll made the cut", "some favorites lately", "kept the good ones"],
  },
  friends: {
    aesthetic: ["the people who make the light better", "a soft documentary"],
    funny: ["these people, obviously", "group chat evidence"],
    cute: ["my people, my favourites", "loved & loud"],
    minimal: ["us", "people", "loved"],
    hype: ["the group chat made me post this", "love them, that's the post"],
    trendy: [
      "main characters for a minute",
      "proof we left the house",
      "soft launch of the weekend",
    ],
  },
  random: {
    aesthetic: ["miscellaneous beauty", "a few from the camera roll"],
    funny: ["my camera roll said hi", "no theme, just vibes"],
    cute: ["little things i liked"],
    minimal: ["bits from lately", "lately", "photo dump"],
    hype: ["photo dump from this week", "couldn't pick a favourite so here's some"],
    trendy: ["camera roll made the cut", "some favorites lately", "little life lately"],
  },
};

const HASHTAGS: Record<VibeFocus, string[]> = {
  cute: ["#photodump", "#softcore", "#corememory", "#dailylife"],
  aesthetic: ["#photodump", "#aesthetic", "#filmphotography", "#moodboard"],
  funny: ["#photodump", "#unserious", "#chaoticgood"],
  vacation: ["#photodump", "#travelgram", "#takemeback", "#vacationmode"],
  food: ["#photodump", "#foodie", "#whatsonmyplate"],
  friends: ["#photodump", "#myfavoritepeople", "#groupchat"],
  random: ["#photodump", "#cameraroll", "#latelydump"],
};

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function topTags(photos: Photo[], n = 4): string[] {
  const counts = new Map<string, number>();
  for (const p of photos) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

export function generateCaptions(
  photos: Photo[],
  vibes: VibeFocus[],
  refreshSeed = 0,
): CaptionIdea[] {
  const primary = (vibes[0] ?? "random") as VibeFocus;
  const secondary = (vibes[1] ?? primary) as VibeFocus;
  const count = photos.length;
  const seed = count * 7 + primary.length * 3 + secondary.length + refreshSeed * 11;
  const bank = BANK[primary];
  const bank2 = BANK[secondary];
  const tagHints = topTags(photos);

  const tagLine = tagHints.length
    ? tagHints
        .slice(0, 3)
        .map((t) => t.toLowerCase())
        .join(" · ")
    : "moments · light · people";

  const hashtags = Array.from(new Set([...HASHTAGS[primary], ...HASHTAGS[secondary]]))
    .slice(0, 6)
    .join(" ");

  const ideas: CaptionIdea[] = [
    { style: "aesthetic", label: "Aesthetic", text: pick(bank.aesthetic, seed) },
    { style: "minimal", label: "Minimal", text: pick(bank.minimal, seed + 1).toLowerCase() },
    { style: "cute", label: "Cute", text: pick(bank.cute, seed + 2) },
    { style: "funny", label: "Funny", text: pick(bank.funny, seed + 3) },
    { style: "trendy", label: "Trendy", text: pick(bank.trendy, seed + 4) },
    { style: "hype", label: "Hype", text: pick(bank2.hype, seed + 5) },
    { style: "aesthetic", label: "Themed", text: `${tagLine}\nphoto dump from lately` },
    { style: "hashtags", label: "Hashtag pack", text: hashtags },
  ];

  console.debug("[dumpdeck] caption templates selected", {
    selectedVibes: vibes,
    seed,
    primary,
    secondary,
    captions: ideas.map((idea) => ({ style: idea.style, label: idea.label, text: idea.text })),
  });

  return ideas;
}
