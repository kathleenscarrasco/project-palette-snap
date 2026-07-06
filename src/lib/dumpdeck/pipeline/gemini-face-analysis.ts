import type { FaceAnalysis } from "../types";
import { imageUrlToBase64 } from "./image-data";

const DEFAULT_MODEL = "gemini-2.5-flash";

type GeminiFaceResponse = {
  numberOfFaces?: unknown;
  croppedFaces?: unknown;
  faces?: unknown;
};

type GeminiFace = {
  faceIndex?: unknown;
  smiling?: { value?: unknown; confidence?: unknown };
  eyesOpen?: { left?: unknown; right?: unknown; both?: unknown; confidence?: unknown };
  approximateAgeGroup?: { value?: unknown; confidence?: unknown };
  headPose?: { yaw?: unknown; pitch?: unknown; roll?: unknown; confidence?: unknown };
  faceVisibility?: { value?: unknown; confidence?: unknown };
  cropped?: { value?: unknown; confidence?: unknown; edges?: unknown };
  box2d?: unknown;
};

export async function analyzeFacesWithGemini(
  imageUrl: string,
  mimeType?: string,
): Promise<FaceAnalysis> {
  try {
    const { data, type } = await imageUrlToBase64(imageUrl, mimeType);
    const response = await fetch("/api/dumpdeck/face-analysis", {
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
      throw new Error(await geminiErrorMessage(response, "Gemini face analysis failed"));
    }

    const body = await response.json();
    const model = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
    return normalizeFaceAnalysis(body.faceAnalysis as GeminiFaceResponse, model);
  } catch (err) {
    console.error("[face-analysis] Gemini face analysis failed", err);
    throw err;
  }
}

export function normalizeFaceAnalysis(
  value: GeminiFaceResponse | undefined,
  model: string,
): FaceAnalysis {
  const faces = Array.isArray(value?.faces) ? value.faces : [];
  const normalizedFaces = faces
    .map((face, index) => normalizeFace(face as GeminiFace, index))
    .filter((face): face is FaceAnalysis["faces"][number] => !!face);

  return {
    numberOfFaces: Math.max(0, Math.round(number(value?.numberOfFaces, normalizedFaces.length))),
    croppedFaces: Math.max(
      0,
      Math.round(
        number(value?.croppedFaces, normalizedFaces.filter((face) => face.cropped.value).length),
      ),
    ),
    faces: normalizedFaces,
    model,
  };
}

function normalizeFace(
  value: GeminiFace,
  fallbackIndex: number,
): FaceAnalysis["faces"][number] | null {
  const faceIndex = Math.max(0, Math.round(number(value.faceIndex, fallbackIndex)));
  const leftEyeOpen = bool(value.eyesOpen?.left);
  const rightEyeOpen = bool(value.eyesOpen?.right);
  const bothEyesOpen = bool(value.eyesOpen?.both, leftEyeOpen && rightEyeOpen);
  const box2d = normalizeBox(value.box2d);

  return {
    faceIndex,
    smiling: {
      value: bool(value.smiling?.value),
      confidence: score(value.smiling?.confidence),
    },
    eyesOpen: {
      left: leftEyeOpen,
      right: rightEyeOpen,
      both: bothEyesOpen,
      confidence: score(value.eyesOpen?.confidence),
    },
    approximateAgeGroup: {
      value: enumValue(value.approximateAgeGroup?.value, [
        "baby",
        "child",
        "teen",
        "young_adult",
        "adult",
        "older_adult",
        "unknown",
      ]),
      confidence: score(value.approximateAgeGroup?.confidence),
    },
    headPose: {
      yaw: enumValue(value.headPose?.yaw, ["left", "center", "right", "unknown"]),
      pitch: enumValue(value.headPose?.pitch, ["up", "level", "down", "unknown"]),
      roll: enumValue(value.headPose?.roll, ["tilted_left", "level", "tilted_right", "unknown"]),
      confidence: score(value.headPose?.confidence),
    },
    faceVisibility: {
      value: enumValue(value.faceVisibility?.value, [
        "clear",
        "partial",
        "obscured",
        "profile",
        "unknown",
      ]),
      confidence: score(value.faceVisibility?.confidence),
    },
    cropped: {
      value: bool(value.cropped?.value),
      confidence: score(value.cropped?.confidence),
      edges: normalizeEdges(value.cropped?.edges),
    },
    ...(box2d ? { box2d } : {}),
  };
}

function normalizeBox(value: unknown): FaceAnalysis["faces"][number]["box2d"] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = value.map((n) => Math.round(score1000(n)));
  return { ymin, xmin, ymax, xmax };
}

function normalizeEdges(value: unknown): FaceAnalysis["faces"][number]["cropped"]["edges"] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["top", "right", "bottom", "left"]);
  return value.filter((edge): edge is "top" | "right" | "bottom" | "left" => {
    return typeof edge === "string" && allowed.has(edge);
  });
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  return typeof value === "string" && allowed.includes(value) ? value : allowed[allowed.length - 1];
}

function bool(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function number(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function score(value: unknown) {
  const n = number(value, 0);
  return Math.min(1, Math.max(0, n));
}

function score1000(value: unknown) {
  const n = number(value, 0);
  return Math.min(1000, Math.max(0, n));
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
