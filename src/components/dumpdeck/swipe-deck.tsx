import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { Heart, X } from "lucide-react";
import { useRef, useState } from "react";
import { TagBadge } from "./tag-badge";
import { ScoreBadge } from "./score-badge";
import type { Photo } from "@/lib/dumpdeck/types";

export function SwipeDeck({
  photos,
  onDecide,
}: {
  photos: Photo[];
  onDecide: (photo: Photo, decision: "keep" | "remove") => void;
}) {
  const top = photos[0];
  const next = photos[1];
  const lockRef = useRef(false);

  function decide(decision: "keep" | "remove") {
    if (!top || lockRef.current) return;
    lockRef.current = true;
    onDecide(top, decision);
    setTimeout(() => {
      lockRef.current = false;
    }, 260);
  }

  if (!top) {
    return (
      <div className="glass-card flex flex-col items-center justify-center rounded-3xl p-10 text-center">
        <div className="font-display text-3xl">All done!</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Tap continue to build your final dump.
        </p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="relative" style={{ aspectRatio: "3 / 4" }}>
        {next && <CardStill key={`still-${next.id}`} photo={next} />}
        <AnimatePresence initial={false}>
          <SwipeCard key={top.id} photo={top} onDecide={decide} />
        </AnimatePresence>
      </div>

      <div className="mt-5 flex items-center justify-center gap-6">
        <button
          onClick={() => decide("remove")}
          className="grid h-16 w-16 place-items-center rounded-full bg-white text-ink shadow-xl ring-1 ring-ink/10 transition active:scale-95"
          aria-label="Remove"
        >
          <X className="h-7 w-7" />
        </button>
        <button
          onClick={() => decide("keep")}
          className="grid h-20 w-20 place-items-center rounded-full bg-coral text-white shadow-2xl shadow-coral/30 transition active:scale-95"
          aria-label="Keep"
        >
          <Heart className="h-9 w-9 fill-current" />
        </button>
      </div>
    </div>
  );
}

function CardStill({ photo }: { photo: Photo }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[2rem] bg-muted opacity-70 shadow-lg"
      style={{ transform: "translateY(12px) scale(0.95)" }}
    >
      <img src={photo.url} alt="" className="h-full w-full object-cover" />
    </div>
  );
}

function SwipeCard({
  photo,
  onDecide,
}: {
  photo: Photo;
  onDecide: (d: "keep" | "remove") => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-18, 0, 18]);
  const keepOpacity = useTransform(x, [0, 120], [0, 1]);
  const nopeOpacity = useTransform(x, [-120, 0], [1, 0]);
  const [exitX, setExitX] = useState(0);

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      style={{ x, rotate }}
      onDragEnd={(_, info) => {
        if (info.offset.x > 120) {
          setExitX(600);
          onDecide("keep");
        } else if (info.offset.x < -120) {
          setExitX(-600);
          onDecide("remove");
        }
      }}
      initial={{ scale: 0.96, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ x: exitX, opacity: 0, transition: { duration: 0.25 } }}
      className="absolute inset-0 cursor-grab overflow-hidden rounded-[2rem] bg-muted shadow-2xl active:cursor-grabbing"
    >
      <img src={photo.url} alt={photo.name} className="h-full w-full object-cover" draggable={false} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

      <motion.div
        style={{ opacity: keepOpacity }}
        className="absolute left-5 top-5 rounded-2xl border-4 border-mint bg-white/90 px-4 py-1 font-display text-3xl text-ink"
      >
        KEEP
      </motion.div>
      <motion.div
        style={{ opacity: nopeOpacity }}
        className="absolute right-5 top-5 rounded-2xl border-4 border-coral bg-white/90 px-4 py-1 font-display text-3xl text-coral"
      >
        NOPE
      </motion.div>

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
        <div className="flex flex-wrap gap-1">
          {photo.tags.map((t) => (
            <TagBadge key={t} tag={t} />
          ))}
        </div>
        <ScoreBadge label="Score" value={photo.overall} />
      </div>
    </motion.div>
  );
}
