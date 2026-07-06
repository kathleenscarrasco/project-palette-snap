import type { SceneAnalysis } from "../types";
import { imageUrlToBase64 } from "./image-data";

const DEFAULT_MODEL = "gemini-2.5-flash";

type GeminiSceneResponse = {
  primaryScene?: unknown;
  secondaryScene?: unknown;
  indoorsOutdoors?: unknown;
  confidenceScores?: Record<string, unknown>;
};

export async function analyzeSceneWithGemini(
  imageUrl: string,
  mimeType?: string,
): Promise<SceneAnalysis> {
  try {
    const { data, type } = await imageUrlToBase64(imageUrl, mimeType);
    const response = await fetch("/api/dumpdeck/scene-analysis", {
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
      throw new Error(await geminiErrorMessage(response, "Gemini scene analysis failed"));
    }

    const body = await response.json();
    const model = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
    return normalizeSceneAnalysis(body.sceneAnalysis as GeminiSceneResponse, model);
  } catch (err) {
    console.error("[scene-analysis] Gemini scene analysis failed", err);
    throw err;
  }
}

export function normalizeSceneAnalysis(
  value: GeminiSceneResponse | undefined,
  model: string,
): SceneAnalysis {
  const result = value ?? {};
  const confidence = result.confidenceScores ?? {};
  const scores: SceneAnalysis["confidenceScores"] = {
    primaryScene: score(confidence.primaryScene),
    secondaryScene: score(confidence.secondaryScene),
    indoors: score(confidence.indoors),
    outdoors: score(confidence.outdoors),
    food: score(confidence.food),
    landscape: score(confidence.landscape),
    beach: score(confidence.beach),
    city: score(confidence.city),
    mountains: score(confidence.mountains),
    pets: score(confidence.pets),
    vehicles: score(confidence.vehicles),
    sports: score(confidence.sports),
  };

  return {
    primaryScene: text(result.primaryScene, "unknown"),
    secondaryScene: text(result.secondaryScene, "unknown"),
    indoorsOutdoors: indoorsOutdoors(result.indoorsOutdoors),
    confidenceScores: scores,
    labels: {
      food: scores.food >= 0.5,
      landscape: scores.landscape >= 0.5,
      beach: scores.beach >= 0.5,
      city: scores.city >= 0.5,
      mountains: scores.mountains >= 0.5,
      pets: scores.pets >= 0.5,
      vehicles: scores.vehicles >= 0.5,
      sports: scores.sports >= 0.5,
    },
    model,
  };
}

function score(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function indoorsOutdoors(value: unknown): SceneAnalysis["indoorsOutdoors"] {
  return value === "indoors" || value === "outdoors" || value === "mixed" ? value : "unknown";
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
