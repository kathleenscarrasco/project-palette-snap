import { cn } from "@/lib/utils";

export function ScoreBadge({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className={cn("rounded-2xl bg-white/70 backdrop-blur px-3 py-2 text-ink", className)}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="font-display text-2xl leading-none">{pct}</span>
        <span className="text-xs text-muted-foreground">/100</span>
      </div>
    </div>
  );
}
