import type { Photo, VibeFocus } from "./types";

export type CaptionStyle = "aesthetic" | "funny" | "minimal" | "cute" | "hype" | "brainrot" | "hashtags";

export type CaptionIdea = {
  style: CaptionStyle;
  label: string;
  text: string;
};

const BANK: Record<VibeFocus, { aesthetic: string[]; funny: string[]; cute: string[]; minimal: string[]; hype: string[]; brainrot: string[] }> = {
  cute: {
    aesthetic: ["soft hours", "little joys, big feelings", "kept the warm ones"],
    funny: ["unserious & thriving", "main character behavior, minor character outfit"],
    cute: ["my heart did a little spin", "collecting moments like stickers", "this is your sign 🩷"],
    minimal: ["softly", "kept", "little days"],
    hype: ["pov: you’re obsessed with your own life", "core memory unlocked"],
    brainrot: ["67 tiny joys later", "soft life but make it skibidi", "mogging my own camera roll"],
  },
  aesthetic: {
    aesthetic: ["color study", "a quiet sequence", "film grain & feelings", "in no particular order"],
    funny: ["the algorithm could never", "delulu but make it composed"],
    cute: ["pretty little nothings", "made of light"],
    minimal: ["frames", "study", "—"],
    hype: ["scroll, stop, stare", "ate down quietly"],
    brainrot: ["pinterest larp went triple platinum", "sigma color study", "this aesthetic is lowkey mogging"],
  },
  funny: {
    aesthetic: ["unhinged but make it cinematic", "art? maybe. crimes? definitely."],
    funny: ["dump truck arrived", "photo dump but i’m the photo", "1, 2, and emotionally 3"],
    cute: ["silly little dump for silly little me"],
    minimal: ["lol", "ok!", "uh"],
    hype: ["serving and i won’t apologize", "wrote this caption 14 times"],
    brainrot: ["67 screenshots and zero context", "skibidi behavior documented", "larping as a functional person"],
  },
  vacation: {
    aesthetic: ["postcards i never sent", "out of office, into the light"],
    funny: ["went away, came back unhinged", "tanned, lost, fed"],
    cute: ["sun-soaked & sweet", "kept the salty ones"],
    minimal: ["away", "abroad", "sun"],
    hype: ["take me back immediately", "the trip dump you asked for"],
    brainrot: ["out of office, in my sigma era", "vacation mogged my entire personality", "67% beach, 41% lost"],
  },
  food: {
    aesthetic: ["a small menu of joy", "plates & places"],
    funny: ["ate everything, regret nothing", "this is a personality trait"],
    cute: ["snacks make me soft"],
    minimal: ["bites", "menu", "fed"],
    hype: ["the food chapter", "rate them 1–10 in the comments"],
    brainrot: ["girl dinner but sigma", "this plate is mogging me", "67 bites later, no regrets"],
  },
  friends: {
    aesthetic: ["the people who make the light better", "a soft documentary"],
    funny: ["these idiots, forever", "evidence of crimes (fun ones)"],
    cute: ["my people, my favourites", "loved & loud"],
    minimal: ["us", "people", "loved"],
    hype: ["the group chat made me post this", "love them, that’s the post"],
    brainrot: ["group chat larp goes public", "the squad is skibidi certified", "67 inside jokes, 41 pending explanations"],
  },
  random: {
    aesthetic: ["miscellaneous beauty", "a few from the camera roll"],
    funny: ["my camera roll said hi", "no theme, just vibes"],
    cute: ["little things i liked"],
    minimal: ["bits", "lately", "dump"],
    hype: ["unfiltered dump incoming", "couldn’t pick a favourite so here’s all of them"],
    brainrot: ["camera roll said skibidi", "67 tabs open in my frontal lobe", "random dump but make it sigma"],
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
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

export function generateCaptions(photos: Photo[], vibes: VibeFocus[]): CaptionIdea[] {
  const primary = (vibes[0] ?? "random") as VibeFocus;
  const secondary = (vibes[1] ?? primary) as VibeFocus;
  const count = photos.length;
  const seed = count * 7 + primary.length * 3 + secondary.length;
  const bank = BANK[primary];
  const bank2 = BANK[secondary];
  const tagHints = topTags(photos);

  const tagLine = tagHints.length
    ? tagHints.slice(0, 3).map((t) => t.toLowerCase()).join(" · ")
    : "moments · light · people";

  const hashtags = Array.from(new Set([...HASHTAGS[primary], ...HASHTAGS[secondary]])).slice(0, 6).join(" ");

  const ideas: CaptionIdea[] = [
    { style: "aesthetic", label: "Aesthetic", text: `${pick(bank.aesthetic, seed)} · ${count} frames` },
    { style: "minimal", label: "Minimal", text: pick(bank.minimal, seed + 1).toLowerCase() },
    { style: "cute", label: "Cute", text: pick(bank.cute, seed + 2) },
    { style: "funny", label: "Funny", text: pick(bank.funny, seed + 3) },
    { style: "brainrot", label: "Brainrot", text: pick(bank.brainrot, seed + 4) },
    { style: "hype", label: "Hype", text: `${pick(bank2.hype, seed + 5)} — slide ${count > 1 ? "till the end" : "for the one"} 🤍` },
    { style: "aesthetic", label: "Themed", text: `${tagLine}\n— a little ${primary} dump` },
    { style: "hashtags", label: "Hashtag pack", text: hashtags },
  ];

  return ideas;
}
