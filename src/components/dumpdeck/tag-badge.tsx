import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/dumpdeck/types";

const STYLES: Record<Tag, string> = {
  "Best lighting": "bg-butter text-ink",
  "Main character": "bg-coral text-white",
  "Good filler": "bg-white/80 text-ink",
  "Too similar": "bg-ink/80 text-white",
  "Golden hour": "bg-butter text-ink",
  "Wide shot": "bg-lavender text-ink",
  "Close up": "bg-mint text-ink",
  "Funny one": "bg-coral text-white",
  "Soft & moody": "bg-lavender text-ink",
  "Punchy color": "bg-butter text-ink",
  "People shot": "bg-mint text-ink",
  Selfie: "bg-mint text-ink",
  Group: "bg-mint text-ink",
  Food: "bg-butter text-ink",
  Landscape: "bg-lavender text-ink",
  Outfit: "bg-lavender text-ink",
  Detail: "bg-white/80 text-ink",
  Random: "bg-white/80 text-ink",
  Unsure: "bg-ink/10 text-ink/60",
  "Good first slide": "bg-coral text-white",
  "Good filler slide": "bg-white/80 text-ink",
  "Best ending": "bg-coral text-white",
};

export function TagBadge({ tag, className }: { tag: Tag; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider shadow-sm",
        STYLES[tag] ?? "bg-white/80 text-ink",
        className,
      )}
    >
      {tag}
    </span>
  );
}
