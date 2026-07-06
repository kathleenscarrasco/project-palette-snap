import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type GeminiAnalysisKind = "scene" | "object" | "face" | "image-understanding";
type GeminiMetricSnapshot = {
  totalRequests: number;
  successfulAnalyses: number;
  retries: number;
  failures: number;
  totalDurationMs: number;
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_ANALYSIS_CONCURRENCY = 3;
const DEFAULT_MAX_GEMINI_PHOTOS = 70;
let geminiStartupLogged = false;
const geminiMetrics: GeminiMetricSnapshot = {
  totalRequests: 0,
  successfulAnalyses: 0,
  retries: 0,
  failures: 0,
  totalDurationMs: 0,
};

const SCENE_SCHEMA = {
  type: "object",
  properties: {
    primaryScene: { type: "string" },
    secondaryScene: { type: "string" },
    indoorsOutdoors: {
      type: "string",
      enum: ["indoors", "outdoors", "mixed", "unknown"],
    },
    confidenceScores: {
      type: "object",
      properties: {
        primaryScene: { type: "number" },
        secondaryScene: { type: "number" },
        indoors: { type: "number" },
        outdoors: { type: "number" },
        food: { type: "number" },
        landscape: { type: "number" },
        beach: { type: "number" },
        city: { type: "number" },
        mountains: { type: "number" },
        pets: { type: "number" },
        vehicles: { type: "number" },
        sports: { type: "number" },
      },
      required: [
        "primaryScene",
        "secondaryScene",
        "indoors",
        "outdoors",
        "food",
        "landscape",
        "beach",
        "city",
        "mountains",
        "pets",
        "vehicles",
        "sports",
      ],
    },
  },
  required: ["primaryScene", "secondaryScene", "indoorsOutdoors", "confidenceScores"],
};

const SCENE_PROMPT = [
  "Analyze this uploaded image for scene context.",
  "Return JSON only matching the supplied schema.",
  "Use concise noun phrases for primaryScene and secondaryScene.",
  "Confidence scores must be numbers from 0 to 1.",
  "Score category presence independently for food, landscape, beach, city, mountains, pets, vehicles, and sports.",
].join(" ");

const OBJECT_DETECTION_SCHEMA = {
  type: "object",
  properties: {
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          labelNormalized: { type: "string" },
          confidence: { type: "number" },
          box2d: {
            type: "array",
            items: { type: "number" },
          },
        },
        required: ["label", "labelNormalized", "confidence", "box2d"],
      },
    },
  },
  required: ["objects"],
};

const OBJECT_DETECTION_PROMPT = [
  "Detect every clearly visible object in this uploaded image.",
  "Return JSON only matching the supplied schema.",
  "Use specific singular object labels such as dog, pizza, bicycle, car, person, plate, or phone.",
  "Set labelNormalized to a lowercase query-friendly singular label using underscores instead of spaces.",
  "Confidence scores must be numbers from 0 to 1.",
  "box2d must be [ymin, xmin, ymax, xmax] normalized to 0-1000.",
  "Include repeated objects separately when each is visible.",
].join(" ");

const FACE_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    numberOfFaces: { type: "number" },
    croppedFaces: { type: "number" },
    faces: {
      type: "array",
      items: {
        type: "object",
        properties: {
          faceIndex: { type: "number" },
          smiling: {
            type: "object",
            properties: {
              value: { type: "boolean" },
              confidence: { type: "number" },
            },
            required: ["value", "confidence"],
          },
          eyesOpen: {
            type: "object",
            properties: {
              left: { type: "boolean" },
              right: { type: "boolean" },
              both: { type: "boolean" },
              confidence: { type: "number" },
            },
            required: ["left", "right", "both", "confidence"],
          },
          approximateAgeGroup: {
            type: "object",
            properties: {
              value: {
                type: "string",
                enum: ["baby", "child", "teen", "young_adult", "adult", "older_adult", "unknown"],
              },
              confidence: { type: "number" },
            },
            required: ["value", "confidence"],
          },
          headPose: {
            type: "object",
            properties: {
              yaw: { type: "string", enum: ["left", "center", "right", "unknown"] },
              pitch: { type: "string", enum: ["up", "level", "down", "unknown"] },
              roll: {
                type: "string",
                enum: ["tilted_left", "level", "tilted_right", "unknown"],
              },
              confidence: { type: "number" },
            },
            required: ["yaw", "pitch", "roll", "confidence"],
          },
          faceVisibility: {
            type: "object",
            properties: {
              value: {
                type: "string",
                enum: ["clear", "partial", "obscured", "profile", "unknown"],
              },
              confidence: { type: "number" },
            },
            required: ["value", "confidence"],
          },
          cropped: {
            type: "object",
            properties: {
              value: { type: "boolean" },
              confidence: { type: "number" },
              edges: {
                type: "array",
                items: { type: "string", enum: ["top", "right", "bottom", "left"] },
              },
            },
            required: ["value", "confidence", "edges"],
          },
          box2d: {
            type: "array",
            items: { type: "number" },
          },
        },
        required: [
          "faceIndex",
          "smiling",
          "eyesOpen",
          "approximateAgeGroup",
          "headPose",
          "faceVisibility",
          "cropped",
          "box2d",
        ],
      },
    },
  },
  required: ["numberOfFaces", "croppedFaces", "faces"],
};

const FACE_ANALYSIS_PROMPT = [
  "Analyze visible human faces in this uploaded image.",
  "Return JSON only matching the supplied schema.",
  "Do not identify anyone or compare faces to real people.",
  "For every detected face, estimate only visible attributes: smiling, eyes open, approximate age group, head pose, face visibility, and whether the face is cropped by the image edge.",
  "Use unknown and low confidence when the face is too small, blurry, obscured, or ambiguous.",
  "Confidence scores must be numbers from 0 to 1.",
  "box2d must be [ymin, xmin, ymax, xmax] normalized to 0-1000.",
].join(" ");

const IMAGE_UNDERSTANDING_SCHEMA = {
  type: "object",
  properties: {
    sceneAnalysis: SCENE_SCHEMA,
    objectDetection: OBJECT_DETECTION_SCHEMA,
    faceAnalysis: FACE_ANALYSIS_SCHEMA,
  },
  required: ["sceneAnalysis", "objectDetection", "faceAnalysis"],
};

const IMAGE_UNDERSTANDING_PROMPT = [
  "Analyze this uploaded image once and return JSON only matching the supplied schema.",
  "Include sceneAnalysis, objectDetection, and faceAnalysis.",
  "Use the same confidence conventions: all confidence scores are numbers from 0 to 1.",
  "Do not identify people or compare faces to real people.",
].join(" ");

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function logGeminiConfiguration(env: unknown) {
  if (geminiStartupLogged) return;
  geminiStartupLogged = true;

  const model = geminiModel(env);
  if (readEnv(env, "GEMINI_API_KEY")) {
    console.info("Gemini configured ✓");
    console.info(`Gemini model: ${model}`);
  } else {
    console.warn(
      "Gemini warning: GEMINI_API_KEY is missing. Image understanding endpoints are disabled.",
    );
    console.info(`Gemini model: ${model}`);
  }
}

function geminiModel(env: unknown) {
  return readEnv(env, "GEMINI_MODEL") ?? GEMINI_DEFAULT_MODEL;
}

function analysisConcurrency(env: unknown) {
  const configured =
    readEnv(env, "DUMPDECK_ANALYSIS_CONCURRENCY") ??
    readEnv(env, "GEMINI_REQUEST_CONCURRENCY") ??
    "";
  const parsed = Number.parseInt(configured, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ANALYSIS_CONCURRENCY;
  return Math.min(10, Math.max(1, parsed));
}

function maxGeminiPhotos(env: unknown) {
  const configured = readEnv(env, "DUMPDECK_MAX_GEMINI_PHOTOS") ?? "";
  const parsed = Number.parseInt(configured, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_GEMINI_PHOTOS;
  return Math.min(200, Math.max(0, parsed));
}

function requireGeminiConfig(env: unknown) {
  const apiKey = readEnv(env, "GEMINI_API_KEY");
  const model = geminiModel(env);
  if (!apiKey) {
    return {
      ok: false as const,
      response: json(
        {
          error: "Gemini is not configured.",
          detail:
            "Set GEMINI_API_KEY on the server. Do not use VITE_GEMINI_API_KEY or expose the key to the frontend.",
          model,
        },
        503,
      ),
    };
  }
  return { ok: true as const, apiKey, model };
}

async function parseImageRequest(request: Request) {
  const body = await request.json().catch(() => null);
  const image = body && typeof body.image === "string" ? body.image : "";
  const mimeType = body && typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
  if (!image) {
    return {
      ok: false as const,
      response: json(
        { error: "Missing image payload. Expected JSON body with image and mimeType." },
        400,
      ),
    };
  }
  const photoId = body && typeof body.photoId === "string" ? body.photoId : undefined;
  const photoName = body && typeof body.photoName === "string" ? body.photoName : undefined;
  const reason = body && typeof body.reason === "string" ? body.reason : undefined;
  const retryCount = body && typeof body.retryCount === "number" ? body.retryCount : 0;
  return { ok: true as const, image, mimeType, photoId, photoName, reason, retryCount };
}

async function generateGeminiJson({
  apiKey,
  image,
  kind,
  mimeType,
  model,
  prompt,
  schema,
  requestMeta,
}: {
  apiKey: string;
  image: string;
  kind: GeminiAnalysisKind;
  mimeType: string;
  model: string;
  prompt: string;
  schema: unknown;
  requestMeta?: {
    photoId?: string;
    photoName?: string;
    reason?: string;
    retryCount?: number;
  };
}) {
  const startedAt = Date.now();
  geminiMetrics.totalRequests += 1;
  if ((requestMeta?.retryCount ?? 0) > 0) {
    geminiMetrics.retries += 1;
  }
  const response = await fetch(
    `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: image,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.1,
        },
      }),
    },
  );

  const retryAfter = response.headers.get("retry-after");
  const baseLog = {
    timestamp: new Date().toISOString(),
    kind,
    photoId: requestMeta?.photoId ?? "unknown",
    photoName: requestMeta?.photoName ?? "unknown",
    reason: requestMeta?.reason ?? kind,
    retryCount: requestMeta?.retryCount ?? 0,
    httpStatus: response.status,
    retryAfter,
    model,
  };

  if (!response.ok) {
    const parsed = await readGeminiError(response);
    const detail = geminiFailureDetail(response.status, parsed.status);
    console.warn(
      "[gemini] request failed",
      JSON.stringify({
        ...baseLog,
        geminiErrorCode: parsed.code,
        geminiErrorMessage: parsed.message,
        geminiErrorStatus: parsed.status,
      }),
    );
    geminiMetrics.failures += 1;
    logGeminiMetrics(kind, startedAt);
    return geminiFailureResponse({
      detail,
      model,
      providerCode: parsed.code,
      providerMessage: parsed.message,
      providerStatus: response.status,
      providerErrorStatus: parsed.status,
      retryAfter,
    });
  }

  console.info("[gemini] request complete", JSON.stringify(baseLog));
  const result = await response.json().catch(() => null);
  const outputText = extractGeminiText(result);
  if (!outputText) {
    geminiMetrics.failures += 1;
    logGeminiMetrics(kind, startedAt);
    return {
      ok: false as const,
      response: json(
        {
          error: "Gemini did not return JSON content.",
          detail: "The provider response did not include a text JSON part.",
          model,
        },
        502,
      ),
    };
  }

  try {
    geminiMetrics.successfulAnalyses += 1;
    logGeminiMetrics(kind, startedAt);
    return { ok: true as const, data: JSON.parse(outputText) };
  } catch (error) {
    console.warn(`[${kind}-analysis] Gemini returned invalid JSON`, error);
    geminiMetrics.failures += 1;
    logGeminiMetrics(kind, startedAt);
    return {
      ok: false as const,
      response: json(
        {
          error: "Gemini returned invalid JSON.",
          detail: "The provider response could not be parsed as JSON.",
          model,
        },
        502,
      ),
    };
  }
}

async function readGeminiError(response: Response) {
  const raw = await response.text();
  try {
    const body = JSON.parse(raw) as {
      error?: { code?: unknown; message?: unknown; status?: unknown };
    };
    return {
      code: typeof body.error?.code === "number" ? body.error.code : response.status,
      message:
        typeof body.error?.message === "string" && body.error.message.trim()
          ? body.error.message
          : raw,
      status:
        typeof body.error?.status === "string" && body.error.status.trim() ? body.error.status : "",
    };
  } catch {
    return { code: response.status, message: raw, status: "" };
  }
}

function geminiFailureDetail(status: number, providerStatus?: string) {
  if (status === 429) {
    if (providerStatus === "RESOURCE_EXHAUSTED") {
      return "Gemini returned RESOURCE_EXHAUSTED. This may be a quota or rate-limit condition; the client queue will retry when appropriate.";
    }
    return "Gemini returned HTTP 429 TooManyRequests. The client queue will retry when appropriate.";
  }
  if (status === 400 || status === 401 || status === 403) {
    return "The configured GEMINI_API_KEY was rejected. Check that the key is valid and has access to the selected model.";
  }
  return "Gemini returned an upstream error after retry attempts.";
}

function geminiFailureResponse({
  detail,
  model,
  providerCode,
  providerMessage,
  providerStatus,
  providerErrorStatus,
  retryAfter,
}: {
  detail: string;
  model: string;
  providerCode: number;
  providerMessage: string;
  providerStatus: number;
  providerErrorStatus?: string;
  retryAfter: string | null;
}) {
  const isAuthError = providerStatus === 400 || providerStatus === 401 || providerStatus === 403;
  const status = providerStatus === 429 ? 429 : isAuthError ? 401 : 502;
  return {
    ok: false as const,
    response: json(
      {
        error: "Gemini analysis failed.",
        detail,
        providerCode,
        providerMessage,
        providerStatus,
        providerErrorStatus,
        retryAfter,
        model,
      },
      status,
    ),
  };
}

function logGeminiMetrics(kind: GeminiAnalysisKind, startedAt: number) {
  const duration = Date.now() - startedAt;
  geminiMetrics.totalDurationMs += duration;
  const completed = geminiMetrics.successfulAnalyses + geminiMetrics.failures;
  const averageAnalysisTimeMs = completed
    ? Math.round(geminiMetrics.totalDurationMs / completed)
    : 0;
  console.info(
    "[gemini] metrics",
    JSON.stringify({
      kind,
      totalRequests: geminiMetrics.totalRequests,
      successfulAnalyses: geminiMetrics.successfulAnalyses,
      retries: geminiMetrics.retries,
      failures: geminiMetrics.failures,
      averageAnalysisTimeMs,
    }),
  );
}

function extractGeminiText(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const candidates = (result as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";
  for (const candidate of candidates) {
    const content =
      candidate && typeof candidate === "object"
        ? (candidate as { content?: unknown }).content
        : null;
    const parts =
      content && typeof content === "object" ? (content as { parts?: unknown }).parts : null;
    if (!Array.isArray(parts)) continue;
    const text = parts
      .map((part) => (part && typeof part === "object" ? (part as { text?: unknown }).text : ""))
      .filter((part): part is string => typeof part === "string")
      .join("");
    if (text.trim()) return text.trim();
  }
  return "";
}

async function handleSceneAnalysis(request: Request, env: unknown) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const config = requireGeminiConfig(env);
  if (!config.ok) return config.response;
  const payload = await parseImageRequest(request);
  if (!payload.ok) return payload.response;
  const result = await generateGeminiJson({
    apiKey: config.apiKey,
    image: payload.image,
    kind: "scene",
    mimeType: payload.mimeType,
    model: config.model,
    prompt: SCENE_PROMPT,
    requestMeta: payload,
    schema: SCENE_SCHEMA,
  });
  if (!result.ok) return result.response;
  return json({ model: config.model, sceneAnalysis: result.data });
}

async function handleObjectDetection(request: Request, env: unknown) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const config = requireGeminiConfig(env);
  if (!config.ok) return config.response;
  const payload = await parseImageRequest(request);
  if (!payload.ok) return payload.response;
  const result = await generateGeminiJson({
    apiKey: config.apiKey,
    image: payload.image,
    kind: "object",
    mimeType: payload.mimeType,
    model: config.model,
    prompt: OBJECT_DETECTION_PROMPT,
    requestMeta: payload,
    schema: OBJECT_DETECTION_SCHEMA,
  });
  if (!result.ok) return result.response;
  return json({ model: config.model, objectDetection: result.data });
}

async function handleFaceAnalysis(request: Request, env: unknown) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const config = requireGeminiConfig(env);
  if (!config.ok) return config.response;
  const payload = await parseImageRequest(request);
  if (!payload.ok) return payload.response;
  const result = await generateGeminiJson({
    apiKey: config.apiKey,
    image: payload.image,
    kind: "face",
    mimeType: payload.mimeType,
    model: config.model,
    prompt: FACE_ANALYSIS_PROMPT,
    requestMeta: payload,
    schema: FACE_ANALYSIS_SCHEMA,
  });
  if (!result.ok) return result.response;
  return json({ model: config.model, faceAnalysis: result.data });
}

async function handleImageUnderstanding(request: Request, env: unknown) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const config = requireGeminiConfig(env);
  if (!config.ok) return config.response;
  const payload = await parseImageRequest(request);
  if (!payload.ok) return payload.response;
  const result = await generateGeminiJson({
    apiKey: config.apiKey,
    image: payload.image,
    kind: "image-understanding",
    mimeType: payload.mimeType,
    model: config.model,
    prompt: IMAGE_UNDERSTANDING_PROMPT,
    requestMeta: payload,
    schema: IMAGE_UNDERSTANDING_SCHEMA,
  });
  if (!result.ok) return result.response;
  return json({ model: config.model, imageUnderstanding: result.data });
}

function handlePipelineConfig(env: unknown) {
  return json({
    analysisConcurrency: analysisConcurrency(env),
    maxGeminiPhotos: maxGeminiPhotos(env),
    geminiModel: geminiModel(env),
  });
}

function readEnv(env: unknown, key: string) {
  if (env && typeof env === "object" && key in env) {
    const value = (env as Record<string, unknown>)[key];
    if (typeof value === "string" && value) return value;
  }
  const value = process.env[key];
  return value || undefined;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      logGeminiConfiguration(env);
      const url = new URL(request.url);
      if (url.pathname === "/api/dumpdeck/scene-analysis") {
        return await handleSceneAnalysis(request, env);
      }
      if (url.pathname === "/api/dumpdeck/object-detection") {
        return await handleObjectDetection(request, env);
      }
      if (url.pathname === "/api/dumpdeck/face-analysis") {
        return await handleFaceAnalysis(request, env);
      }
      if (url.pathname === "/api/dumpdeck/image-understanding") {
        return await handleImageUnderstanding(request, env);
      }
      if (url.pathname === "/api/dumpdeck/pipeline-config") {
        return handlePipelineConfig(env);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
