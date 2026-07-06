export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <img
      src="/favicon.svg"
      alt=""
      aria-hidden
      className={`${className} rounded-xl shadow-sm`}
      decoding="async"
    />
  );
}

export function BrandWordmark({
  size = "text-lg",
  className = "",
}: {
  size?: string;
  className?: string;
}) {
  return <span className={`font-display ${size} ${className}`}>DumpDeck</span>;
}
