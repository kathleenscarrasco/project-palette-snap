import { Sparkles, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type UploadItem = {
  id: string;
  url: string;
  previewUrl?: string;
  name: string;
  width: number;
  height: number;
};

function makePreviewUrl(img: HTMLImageElement, maxSide = 1280): Promise<string> {
  return new Promise((resolve) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) {
      resolve(img.src);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(img.src);
      return;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => resolve(blob ? URL.createObjectURL(blob) : img.src),
      "image/jpeg",
      0.82,
    );
  });
}

function readImage(file: File): Promise<UploadItem> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const previewUrl = await makePreviewUrl(img);
      resolve({
        id: crypto.randomUUID(),
        url,
        previewUrl,
        name: file.name,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function UploadGrid({
  items,
  onAdd,
  onRemove,
  onAnalyze,
}: {
  items: UploadItem[];
  onAdd: (items: UploadItem[]) => void;
  onRemove: (id: string) => void;
  onAnalyze: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    setBusy(true);
    setProgress(0);
    const out: UploadItem[] = [];
    for (let i = 0; i < arr.length; i++) {
      try {
        out.push(await readImage(arr[i]));
      } catch {}
      setProgress(Math.round(((i + 1) / arr.length) * 100));
    }
    onAdd(out);
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "glass-card flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-10 text-center transition",
          dragOver ? "border-coral bg-coral/5" : "border-ink/15",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-coral text-white shadow-lg">
          <Upload className="h-6 w-6" />
        </div>
        <div className="mt-4 font-display text-2xl">Drop your camera roll</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Tap to pick photos · the more, the better
        </div>
        {busy && (
          <div className="mt-4 w-full max-w-xs">
            <div className="h-2 overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-coral transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Loading {progress}%</div>
          </div>
        )}
      </label>

      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between px-1">
            <div className="text-sm font-semibold">
              {items.length} photo{items.length === 1 ? "" : "s"} ready
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-sm font-semibold text-coral"
            >
              + Add more
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {items.map((it) => (
              <div
                key={it.id}
                className="group relative overflow-hidden rounded-2xl bg-muted"
                style={{ aspectRatio: "1 / 1" }}
              >
                <img src={it.previewUrl ?? it.url} alt={it.name} decoding="async" loading="lazy" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemove(it.id)}
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <Button
            size="lg"
            className="h-14 w-full rounded-2xl bg-coral text-base font-semibold text-white shadow-lg hover:bg-coral/90"
            onClick={onAnalyze}
            disabled={busy || items.length < 4}
          >
            {items.length < 4 ? (
              `Add ${4 - items.length} more to analyze`
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" strokeWidth={2.4} />
                Analyze my {items.length} photos
              </>
            )}
          </Button>

        </>
      )}
    </div>
  );
}
