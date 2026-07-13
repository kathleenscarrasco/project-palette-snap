import { Sparkles, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UploadItem } from "@/lib/dumpdeck/types";

const ACCEPTED_PHOTO_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif|gif)$/i;
const ACCEPTED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);
export const INPUT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".gif",
].join(",");

const HEIC_CONVERSION_QUALITY = 0.95;
const PREVIEW_QUALITY = 0.9;
const PREPARE_CONCURRENCY = 4;

type Heic2Any = (typeof import("heic2any"))["default"];
type HeicTo = (typeof import("heic-to"))["heicTo"];

type PreparedImageSource = {
  blob: Blob;
  mimeType: string;
  originalMimeType: string;
  convertedFromHeic: boolean;
  conversionQuality?: number;
  conversionDecoder?: string;
};

function makePreviewUrl(img: HTMLImageElement, maxSide = 1600): Promise<string> {
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
      PREVIEW_QUALITY,
    );
  });
}

export async function readImage(file: File): Promise<UploadItem> {
  const startedAt = performance.now();
  const fingerprint = await fingerprintFile(file);
  const source = await prepareImageSource(file);

  return new Promise((resolve, reject) => {
    const originalFileUrl = URL.createObjectURL(file);
    const url = URL.createObjectURL(source.blob);
    const img = new Image();
    img.onload = async () => {
      const previewUrl = await makePreviewUrl(img);
      console.debug("[perf] photo prepared", {
        name: file.name,
        mimeType: source.mimeType,
        originalMimeType: source.originalMimeType,
        convertedFromHeic: source.convertedFromHeic,
        originalBytes: file.size,
        preparedBytes: source.blob.size,
        previewGenerationMs: Math.round(performance.now() - startedAt),
      });
      resolve({
        id: crypto.randomUUID(),
        url,
        originalFileUrl,
        previewFileUrl: previewUrl,
        previewUrl,
        name: file.name,
        width: img.naturalWidth,
        height: img.naturalHeight,
        fingerprint,
        byteSize: source.blob.size,
        mimeType: source.mimeType,
        originalMimeType: source.originalMimeType,
        convertedFromHeic: source.convertedFromHeic,
        conversionQuality: source.conversionQuality,
        conversionDecoder: source.conversionDecoder,
        originalByteSize: file.size,
        previewByteSize: source.blob.size,
        lastModified: file.lastModified,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(originalFileUrl);
      reject(new Error(friendlyDecodeError(file)));
    };
    img.src = url;
  });
}

async function prepareImageSource(file: File): Promise<PreparedImageSource> {
  const originalMimeType = file.type || mimeTypeFromName(file.name) || "image/jpeg";
  if (!isHeicFile(file)) {
    return {
      blob: file,
      mimeType: originalMimeType,
      originalMimeType,
      convertedFromHeic: false,
    };
  }

  const startedAt = performance.now();
  const errors: string[] = [];
  try {
    console.debug("[upload] preparing HEIC/HEIF photo", { name: file.name, decoder: "heic-to" });
    const { heicTo } = (await import("heic-to")) as { heicTo: HeicTo };
    const converted = await heicTo({
      blob: file,
      type: "image/jpeg",
      quality: HEIC_CONVERSION_QUALITY,
    });
    if (!(converted instanceof Blob)) throw new Error("HEIC conversion returned no image");
    console.debug("[upload] HEIC/HEIF photo ready", {
      name: file.name,
      decoder: "heic-to",
      conversionQuality: HEIC_CONVERSION_QUALITY,
      originalBytes: file.size,
      convertedBytes: converted.size,
      ms: Math.round(performance.now() - startedAt),
    });
    return {
      blob: converted,
      mimeType: "image/jpeg",
      originalMimeType,
      convertedFromHeic: true,
      conversionQuality: HEIC_CONVERSION_QUALITY,
      conversionDecoder: "heic-to",
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    console.warn("[upload] HEIC conversion failed with heic-to", error);
  }

  try {
    console.debug("[upload] preparing HEIC/HEIF photo", { name: file.name, decoder: "heic2any" });
    const heic2any = (await import("heic2any")).default as Heic2Any;
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: HEIC_CONVERSION_QUALITY,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!(blob instanceof Blob)) throw new Error("HEIC conversion returned no image");
    console.debug("[upload] HEIC/HEIF photo ready", {
      name: file.name,
      decoder: "heic2any",
      conversionQuality: HEIC_CONVERSION_QUALITY,
      originalBytes: file.size,
      convertedBytes: blob.size,
      ms: Math.round(performance.now() - startedAt),
    });
    return {
      blob,
      mimeType: "image/jpeg",
      originalMimeType,
      convertedFromHeic: true,
      conversionQuality: HEIC_CONVERSION_QUALITY,
      conversionDecoder: "heic2any",
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    console.warn("[upload] HEIC conversion failed with heic2any", error);
    throw new Error(
      `${file.name} could not be converted from HEIC/HEIF. ${errors.length ? `Decoder said: ${errors[errors.length - 1]}` : "Try exporting it as JPEG/WebP and uploading again."}`,
    );
  }
}

export function isHeicFile(file: File) {
  return /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
}

function mimeTypeFromName(name: string) {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.(heic|heif)$/i.test(name)) return "image/heic";
  return "";
}

export function isSupportedPhotoFile(file: File) {
  const type = file.type.toLowerCase();
  return ACCEPTED_PHOTO_TYPES.has(type) || ACCEPTED_PHOTO_EXTENSIONS.test(file.name);
}

export function friendlyDecodeError(file: File) {
  if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) {
    return `${file.name} could not be converted from HEIC/HEIF. Try exporting it as JPEG/WebP and uploading again.`;
  }
  return `${file.name} could not be previewed. It may be corrupt or an unsupported image file.`;
}

async function fingerprintFile(file: File): Promise<string | undefined> {
  const startedAt = performance.now();
  try {
    const buffer = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    const fingerprint = Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    console.debug("[perf] file fingerprinted", {
      name: file.name,
      bytes: file.size,
      fingerprintMs: Math.round(performance.now() - startedAt),
    });
    return fingerprint;
  } catch (err) {
    console.warn("[upload] Failed to fingerprint image", err);
    return undefined;
  }
}

export function UploadGrid({
  items,
  onAdd,
  onRemove,
  onAnalyze,
  analyzeBusy = false,
  analyzeLabel = "Getting photos ready…",
}: {
  items: UploadItem[];
  onAdd: (items: UploadItem[]) => void;
  onRemove: (id: string) => void;
  onAnalyze: () => void | Promise<void>;
  analyzeBusy?: boolean;
  analyzeLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState("");

  async function handleFiles(files: FileList | File[]) {
    const batchStartedAt = performance.now();
    const selected = Array.from(files);
    const arr = selected.filter(isSupportedPhotoFile);
    const unsupported = selected
      .filter((file) => !isSupportedPhotoFile(file))
      .map((file) => `${file.name} is not a supported photo format.`);
    setErrors(unsupported);
    if (!arr.length) return;
    setBusy(true);
    setProgress(0);
    setStatus(`0/${arr.length} photos ready…`);
    let completed = 0;
    let ready = 0;
    const failed: string[] = [];
    let cursor = 0;
    let firstPreviewMs: number | null = null;

    async function worker() {
      while (cursor < arr.length) {
        const file = arr[cursor++];
        const itemStartedAt = performance.now();
        try {
          const item = await readImage(file);
          ready += 1;
          if (firstPreviewMs === null)
            firstPreviewMs = Math.round(performance.now() - batchStartedAt);
          onAdd([item]);
          console.debug("[perf] upload file selection item ready", {
            name: file.name,
            ready,
            total: arr.length,
            itemMs: Math.round(performance.now() - itemStartedAt),
          });
        } catch (err) {
          console.warn("[upload] Failed to load image", err);
          failed.push(err instanceof Error ? err.message : `${file.name} could not be loaded.`);
        } finally {
          completed += 1;
          setProgress(Math.round((completed / arr.length) * 100));
          const suffix = completed === arr.length ? "" : "…";
          setStatus(`${ready}/${arr.length} photos ready${suffix}`);
        }
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(PREPARE_CONCURRENCY, arr.length) }, () => worker()),
      );
    } finally {
      console.debug("[perf] upload batch prepared", {
        totalSelected: selected.length,
        supportedSelected: arr.length,
        unsupported: unsupported.length,
        ready,
        failed: failed.length,
        timeToFirstPreviewMs: firstPreviewMs,
        totalFileSelectionMs: Math.round(performance.now() - batchStartedAt),
        prepareConcurrency: PREPARE_CONCURRENCY,
      });
      setErrors([...unsupported, ...failed]);
      setBusy(false);
      setStatus("");
    }
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
          accept={INPUT_ACCEPT}
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
            <div className="mt-1 text-xs text-muted-foreground">
              {status || `Loading ${progress}%`}
            </div>
          </div>
        )}
      </label>

      {errors.length > 0 && (
        <div className="rounded-2xl border border-coral/20 bg-coral/10 p-3 text-xs text-ink/75">
          <div className="font-semibold text-coral">
            {errors.length === 1 ? "One photo needs attention" : "Some photos need attention"}
          </div>
          <ul className="mt-1 space-y-1">
            {errors.slice(0, 4).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          {errors.length > 4 && (
            <div className="mt-1 text-muted-foreground">+ {errors.length - 4} more</div>
          )}
        </div>
      )}

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
                <img
                  src={it.previewUrl ?? it.url}
                  alt={it.name}
                  decoding="async"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
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
            disabled={busy || analyzeBusy || items.length < 4}
          >
            {analyzeBusy ? (
              analyzeLabel
            ) : items.length < 4 ? (
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
