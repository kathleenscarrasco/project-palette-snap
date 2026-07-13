import type { DetectedObject } from "../types";
import { imageUrlToBase64 } from "./image-data";

const DEFAULT_MODEL = "gemini-2.5-flash";

type GeminiObjectResponse = {
  objects?: unknown;
};

type GeminiObject = {
  label?: unknown;
  labelNormalized?: unknown;
  confidence?: unknown;
  box2d?: unknown;
};

export async function detectObjectsWithGemini(
  imageUrl: string,
  mimeType?: string,
): Promise<DetectedObject[]> {
  try {
    const { data, type } = await imageUrlToBase64(imageUrl, mimeType);
    const response = await fetch("/api/dumpdeck/object-detection", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        image: data,
        mimeType: type,
      }),
    });

    if (!response.ok) {
      throw new Error(await geminiErrorMessage(response, "Gemini object detection failed"));
    }

    const body = await response.json();
    const model = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
    return normalizeDetectedObjects(body.objectDetection as GeminiObjectResponse, model);
  } catch (err) {
    console.error("[object-detection] Gemini object detection failed", err);
    throw err;
  }
}

export function normalizeDetectedObjects(
  value: GeminiObjectResponse | undefined,
  model: string,
): DetectedObject[] {
  const objects = Array.isArray(value?.objects) ? value.objects : [];
  return objects
    .map((item) => normalizeDetectedObject(item as GeminiObject, model))
    .filter((item): item is DetectedObject => !!item);
}

function normalizeDetectedObject(value: GeminiObject, model: string): DetectedObject | null {
  const label = text(value.label);
  const labelNormalized = normalizeLabel(text(value.labelNormalized) || label);
  if (!label || !labelNormalized) return null;

  const detected: DetectedObject = {
    label,
    labelNormalized,
    confidence: score(value.confidence),
    model,
  };

  const box2d = normalizeBox(value.box2d);
  if (box2d) detected.box2d = box2d;
  return detected;
}

function normalizeBox(value: unknown): DetectedObject["box2d"] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = value.map((n) => Math.round(score1000(n)));
  return { ymin, xmin, ymax, xmax };
}

function normalizeLabel(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function score(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function score1000(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1000, Math.max(0, n));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function geminiErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return `${fallback}: ${detail}`;
    if (typeof error === "string") return `${fallback}: ${error}`;
  }
  return `${fallback}: HTTP ${response.status}`;
}
