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
        {Math.round(photo.overall * 100)}
      </div>
      {overlay}
    </button>
  );
}
