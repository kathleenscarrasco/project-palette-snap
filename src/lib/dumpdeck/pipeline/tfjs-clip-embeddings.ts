import type { ClipImageEmbedding } from "../types";
import type * as tf from "@tensorflow/tfjs";

const CLIP_INPUT_SIZE = 224;
const CLIP_DIMENSIONS = 512;
const MODEL_VERSION = "tfjs-clip-image-v1";

type TensorFlowModule = typeof import("@tensorflow/tfjs");

let tfPromise: Promise<TensorFlowModule> | null = null;
let modelPromise: Promise<tf.GraphModel | tf.LayersModel | null> | null = null;

export type ClipEmbeddingResult = {
  metadata: ClipImageEmbedding;
  vector?: number[];
};

export async function generateClipImageEmbedding(imageUrl: string): Promise<ClipEmbeddingResult> {
  const modelUrl = import.meta.env.VITE_CLIP_IMAGE_MODEL_URL as string | undefined;
  if (!modelUrl) {
    return unavailableEmbedding("unconfigured");
  }

  const tf = await loadTensorFlow();
  const model = await loadClipModel(tf, modelUrl);
  if (!model) {
    return unavailableEmbedding(modelUrl);
  }

  try {
    const img = await loadImage(imageUrl);
    const output = tf.tidy(() => {
      const input = tf.browser
        .fromPixels(img)
        .resizeBilinear([CLIP_INPUT_SIZE, CLIP_INPUT_SIZE])
        .toFloat()
        .div(255)
        .sub([0.48145466, 0.4578275, 0.40821073])
        .div([0.26862954, 0.26130258, 0.27577711])
        .expandDims(0);
      return model.predict(input) as tf.Tensor | tf.Tensor[];
    });

    const tensor = Array.isArray(output) ? output[0] : output;
    const values = Array.from(await tensor.data()).slice(0, CLIP_DIMENSIONS);
    if (Array.isArray(output)) output.forEach((item) => item.dispose());
    else output.dispose();

    if (values.length !== CLIP_DIMENSIONS) {
      console.warn("[clip-embedding] Expected 512 dimensions, received", values.length);
      return unavailableEmbedding(modelUrl);
    }

    const vector = l2Normalize(values);
    return {
      metadata: {
        dimensions: CLIP_DIMENSIONS,
        model: modelUrl,
        modelVersion: MODEL_VERSION,
        modelAvailable: true,
        stored: false,
      },
      vector,
    };
  } catch (err) {
    console.warn("[clip-embedding] Model embedding failed", err);
    return unavailableEmbedding(modelUrl);
  }
}

function loadTensorFlow() {
  if (!tfPromise) {
    tfPromise = import("@tensorflow/tfjs");
  }
  return tfPromise;
}

function loadClipModel(tf: TensorFlowModule, modelUrl: string) {
  if (!modelPromise) {
    modelPromise = tf.loadGraphModel(modelUrl).catch(async (graphErr) => {
      console.warn("[clip-embedding] GraphModel load failed, trying LayersModel", graphErr);
      return tf.loadLayersModel(modelUrl).catch((layersErr) => {
        console.warn("[clip-embedding] LayersModel load failed", layersErr);
        return null;
      });
    });
  }
  return modelPromise;
}

function l2Normalize(values: number[]) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function unavailableEmbedding(model: string): ClipEmbeddingResult {
  return {
    metadata: {
      dimensions: 0,
      model,
      modelVersion: MODEL_VERSION,
      modelAvailable: false,
      stored: false,
    },
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}
