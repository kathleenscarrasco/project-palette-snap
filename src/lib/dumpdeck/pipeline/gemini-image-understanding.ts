import type { DetectedObject, FaceAnalysis, SceneAnalysis } from "../types";
import { imageUrlToBase64 } from "./image-data";
import { normalizeFaceAnalysis } from "./gemini-face-analysis";
import { normalizeDetectedObjects } from "./gemini-object-detection";
import { normalizeSceneAnalysis } from "./gemini-scene-analysis";

const DEFAULT_MODEL = "gemini-2.5-flash";

type GeminiUnderstandingResponse = {
  sceneAnalysis?: unknown;
  objectDetection?: unknown;
  faceAnalysis?: unknown;
};

export type GeminiRequestMeta = {
  photoId?: string;
  photoName?: string;
  reason?: string;
  retryCount?: number;
};

export type GeminiImageUnderstanding = {
  sceneAnalysis: SceneAnalysis;
  detectedObjects: DetectedObject[];
  faceAnalysis: FaceAnalysis;
};

export class GeminiAnalysisError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: number;
  readonly providerStatus?: string;
  readonly retryAfterMs?: number;

  constructor(message: string, options: Omit<GeminiAnalysisError, "name" | "message">) {
    super(message);
    this.name = "GeminiAnalysisError";
    this.retryable = options.retryable;
    this.status = options.status;
    this.providerCode = options.providerCode;
    this.providerStatus = options.providerStatus;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export async function analyzeImageUnderstandingWithGemini(
  imageUrl: string,
  mimeType?: string,
  requestMeta: GeminiRequestMeta = {},
): Promise<GeminiImageUnderstanding> {
  const { data, type } = await imageUrlToBase64(imageUrl, mimeType);
  const response = await fetch("/api/dumpdeck/image-understanding", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      image: data,
      mimeType: type,
      ...requestMeta,
    }),
  });

  if (!response.ok) {
    throw await geminiError(response, "Gemini image understanding failed");
  }

  const body = await response.json();
  const model = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
  const value = (body.imageUnderstanding ?? {}) as GeminiUnderstandingResponse;
  return {
    sceneAnalysis: normalizeSceneAnalysis(value.sceneAnalysis as never, model),
    detectedObjects: normalizeDetectedObjects(value.objectDetection as never, model),
    faceAnalysis: normalizeFaceAnalysis(value.faceAnalysis as never, model),
  };
}

async function geminiError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : null;
  const providerMessage =
    body && typeof body === "object" ? (body as { providerMessage?: unknown }).providerMessage : "";
  const providerStatus =
    body && typeof body === "object"
      ? (body as { providerErrorStatus?: unknown }).providerErrorStatus
      : "";
  const providerCode =
    body && typeof body === "object"
      ? Number((body as { providerCode?: unknown }).providerCode)
      : 0;
  const retryAfter =
    body && typeof body === "object" ? (body as { retryAfter?: unknown }).retryAfter : null;
  const retryAfterMs = retryAfterMsFromHeader(typeof retryAfter === "string" ? retryAfter : null);
  const message = [
    fallback,
    typeof detail === "string" ? detail : `HTTP ${response.status}`,
    typeof providerStatus === "string" && providerStatus ? providerStatus : "",
    typeof providerMessage === "string" && providerMessage ? providerMessage : "",
  ]
    .filter(Boolean)
    .join(": ");

  return new GeminiAnalysisError(message, {
    retryable: isRetryable(
      response.status,
      typeof providerStatus === "string" ? providerStatus : "",
    ),
    status: response.status,
    providerCode: Number.isFinite(providerCode) ? providerCode : response.status,
    providerStatus: typeof providerStatus === "string" ? providerStatus : undefined,
    retryAfterMs,
  });
}

function isRetryable(status: number, providerStatus: string) {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status === 503 ||
    status >= 500 ||
    providerStatus === "RESOURCE_EXHAUSTED" ||
    providerStatus === "UNAVAILABLE"
  );
}

function retryAfterMsFromHeader(value: string | null) {
  if (!value) return undefined;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(120000, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, Math.min(120000, dateMs - Date.now()));
  return undefined;
}
