import type * as cocoSsd from "@tensorflow-models/coco-ssd";
import type { FaceDetector } from "@mediapipe/tasks-vision";

export type Box = { x: number; y: number; w: number; h: number; score: number };

export type DetectionResult = {
  detectedPeopleCount: number;
  detectedFaceCount: number;
  confidence: number;
  unsure: boolean;
  peopleBoxes: Box[];
  faceBoxes: Box[];
  source: "coco+face" | "coco" | "face" | "none";
};

const PERSON_THRESHOLD = 0.6;
const FACE_THRESHOLD = 0.55;
const SKIP_BROWSER_MODELS =
  import.meta.env.DEV && import.meta.env.VITE_DUMPDECK_DEV_AUTH === "true";

let cocoPromise: Promise<cocoSsd.ObjectDetection | null> | null = null;
let facePromise: Promise<FaceDetector | null> | null = null;

function loadCoco(): Promise<cocoSsd.ObjectDetection | null> {
  if (SKIP_BROWSER_MODELS) return Promise.resolve(null);
  if (!cocoPromise) {
    cocoPromise = (async () => {
      try {
        await import("@tensorflow/tfjs");
        const model = await import("@tensorflow-models/coco-ssd");
        return await model.load({ base: "lite_mobilenet_v2" });
      } catch (err) {
        console.warn("[detection] COCO-SSD failed to load", err);
        return null;
      }
    })();
  }
  return cocoPromise;
}

function loadFace(): Promise<FaceDetector | null> {
  if (SKIP_BROWSER_MODELS) return Promise.resolve(null);
  if (!facePromise) {
    facePromise = (async () => {
      try {
        const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
        );
        return await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "GPU",
          },
          runningMode: "IMAGE",
          minDetectionConfidence: FACE_THRESHOLD,
        });
      } catch (err) {
        console.warn("[detection] MediaPipe FaceDetector failed to load", err);
        return null;
      }
    })();
  }
  return facePromise;
}

export async function warmupDetection() {
  await Promise.all([loadCoco(), loadFace()]);
}

function loadHTMLImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
}

export async function detectPeopleAndFaces(url: string): Promise<DetectionResult> {
  let img: HTMLImageElement;
  try {
    img = await loadHTMLImage(url);
  } catch {
    return emptyResult();
  }

  const [coco, face] = await Promise.all([loadCoco(), loadFace()]);

  const peopleBoxes: Box[] = [];
  let cocoOk = false;
  if (coco) {
    try {
      const preds = await coco.detect(img);
      for (const p of preds) {
        if (p.class === "person" && p.score >= PERSON_THRESHOLD) {
          peopleBoxes.push({
            x: p.bbox[0],
            y: p.bbox[1],
            w: p.bbox[2],
            h: p.bbox[3],
            score: p.score,
          });
        }
      }
      cocoOk = true;
    } catch (err) {
      console.warn("[detection] COCO detect failed", err);
    }
  }

  const faceBoxes: Box[] = [];
  let faceOk = false;
  if (face) {
    try {
      const out = face.detect(img);
      for (const d of out.detections ?? []) {
        const cat = d.categories?.[0];
        const score = cat?.score ?? 0;
        if (score >= FACE_THRESHOLD && d.boundingBox) {
          faceBoxes.push({
            x: d.boundingBox.originX,
            y: d.boundingBox.originY,
            w: d.boundingBox.width,
            h: d.boundingBox.height,
            score,
          });
        }
      }
      faceOk = true;
    } catch (err) {
      console.warn("[detection] Face detect failed", err);
    }
  }

  const detectedPeopleCount = peopleBoxes.length;
  const detectedFaceCount = faceBoxes.length;

  let source: DetectionResult["source"] = "none";
  if (cocoOk && faceOk) source = "coco+face";
  else if (cocoOk) source = "coco";
  else if (faceOk) source = "face";

  let confidence = 0;
  let unsure = false;

  if (source === "coco+face") {
    if (detectedPeopleCount === 0 && detectedFaceCount === 0) {
      confidence = 0.95;
    } else if (Math.abs(detectedPeopleCount - detectedFaceCount) <= 1) {
      const avgScore = avg([...peopleBoxes.map((b) => b.score), ...faceBoxes.map((b) => b.score)]);
      confidence = Math.min(0.98, 0.7 + avgScore * 0.25);
    } else {
      confidence = 0.35;
      unsure = true;
    }
  } else if (source === "coco" || source === "face") {
    const arr = source === "coco" ? peopleBoxes : faceBoxes;
    confidence = arr.length === 0 ? 0.5 : Math.min(0.75, 0.4 + avg(arr.map((b) => b.score)) * 0.4);
    unsure = arr.length > 0;
  } else {
    confidence = 0;
    unsure = true;
  }

  return {
    detectedPeopleCount,
    detectedFaceCount,
    confidence,
    unsure,
    peopleBoxes,
    faceBoxes,
    source,
  };
}

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function emptyResult(): DetectionResult {
  return {
    detectedPeopleCount: 0,
    detectedFaceCount: 0,
    confidence: 0,
    unsure: true,
    peopleBoxes: [],
    faceBoxes: [],
    source: "none",
  };
}
