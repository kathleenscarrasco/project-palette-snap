import { cn } from "@/lib/utils";
import { TagBadge } from "./tag-badge";
import type { Photo } from "@/lib/dumpdeck/types";

export function PhotoCard({
  photo,
  className,
  showTags = true,
  overlay,
  onClick,
}: {
  photo: Photo;
  className?: string;
  showTags?: boolean;
  overlay?: React.ReactNode;
  onClick?: () => void;
}) {
  const analysis = photo.unifiedAnalysis?.analysis;
  const score = analysis?.rankingScore ?? photo.overall;
  const scene = analysis?.scene ?? photo.photoType;
  const quality = analysis?.technicalQuality.overall ?? photo.scores.quality;
  const deepScanned = Boolean(
    analysis?.modelTrace.scene ||
    analysis?.modelTrace.objects?.length ||
    analysis?.modelTrace.faces,
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative block w-full overflow-hidden rounded-3xl bg-muted text-left shadow-sm transition active:scale-[0.98]",
        className,
      )}
      style={{ aspectRatio: "4 / 5" }}
    >
      <img
        src={photo.previewUrl ?? photo.url}
        alt={photo.name}
        decoding="async"
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
      {showTags && photo.tags.length > 0 && (
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {photo.tags.map((t) => (
            <TagBadge key={t} tag={t} />
          ))}
        </div>
      )}
      <div className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-ink shadow-sm">
        {Math.round(score * 100)}
      </div>
      <div className="absolute inset-x-2 bottom-2 space-y-1">
        <div className="flex flex-wrap gap-1">
          <span className="rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            {scene}
          </span>
          <span className="rounded-full bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-ink">
            Q {Math.round(quality * 100)}
          </span>
          {analysis && analysis.peopleCount > 0 && (
            <span className="rounded-full bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-ink">
              {analysis.peopleCount} people
            </span>
          )}
          {deepScanned && (
            <span
              title="FotoFairy used additional AI analysis for this photo because it needed a closer look."
              className="rounded-full bg-mint/90 px-1.5 py-0.5 text-[9px] font-bold text-ink"
            >
              Closer review
            </span>
          )}
        </div>
      </div>
      {overlay}
    </button>
  );
}
