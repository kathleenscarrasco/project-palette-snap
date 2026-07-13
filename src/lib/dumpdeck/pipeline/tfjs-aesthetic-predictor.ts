import type { AestheticScore } from "../types";
import type * as tf from "@tensorflow/tfjs";

const INPUT_SIZE = 224;
const MODEL_VERSION = "tfjs-aesthetic-v1";

type TensorFlowModule = typeof import("@tensorflow/tfjs");

let tfPromise: Promise<TensorFlowModule> | null = null;
let modelPromise: Promise<tf.GraphModel | tf.LayersModel | null> | null = null;

export async function predictAestheticScore(imageUrl: string): Promise<AestheticScore> {
  const modelUrl = import.meta.env.VITE_AESTHETIC_MODEL_URL as string | undefined;
  if (!modelUrl) {
    return unavailableScore("unconfigured");
  }

  const tf = await loadTensorFlow();
  const model = await loadAestheticModel(tf, modelUrl);
  if (!model) {
    return unavailableScore(modelUrl);
  }

  try {
    const img = await loadImage(imageUrl);
    const output = tf.tidy(() => {
      const input = tf.browser
        .fromPixels(img)
        .resizeBilinear([INPUT_SIZE, INPUT_SIZE])
        .toFloat()
        .div(255)
        .sub([0.485, 0.456, 0.406])
        .div([0.229, 0.224, 0.225])
        .expandDims(0);
      return model.predict(input) as tf.Tensor | tf.Tensor[];
    });

    const tensor = Array.isArray(output) ? output[0] : output;
    const values = Array.from(await tensor.data());
    if (Array.isArray(output)) output.forEach((item) => item.dispose());
    else output.dispose();

    const prediction = interpretPrediction(values);
    return {
      score: prediction.score,
      confidence: prediction.confidence,
      model: modelUrl,
      modelVersion: MODEL_VERSION,
      modelAvailable: true,
    };
  } catch (err) {
    console.warn("[aesthetic-score] Model prediction failed", err);
    return unavailableScore(modelUrl);
  }
}

function loadTensorFlow() {
  if (!tfPromise) {
    tfPromise = import("@tensorflow/tfjs");
  }
  return tfPromise;
}

function loadAestheticModel(tf: TensorFlowModule, modelUrl: string) {
  if (!modelPromise) {
    modelPromise = tf.loadGraphModel(modelUrl).catch(async (graphErr) => {
      console.warn("[aesthetic-score] GraphModel load failed, trying LayersModel", graphErr);
      return tf.loadLayersModel(modelUrl).catch((layersErr) => {
        console.warn("[aesthetic-score] LayersModel load failed", layersErr);
        return null;
      });
    });
  }
  return modelPromise;
}

function interpretPrediction(values: number[]) {
  if (values.length >= 10) {
    const bins = values.slice(0, 10);
    const probs = looksLikeProbabilities(bins) ? normalize(bins) : softmax(bins);
    const expected = probs.reduce((sum, prob, index) => sum + prob * (index + 1), 0);
    return {
      score: clamp(expected, 0, 10),
      confidence: clamp(Math.max(...probs)),
    };
  }

  const raw = values[0] ?? 0;
  const score = raw <= 1 ? raw * 10 : raw;
  return {
    score: clamp(score, 0, 10),
    confidence: 1,
  };
}

function looksLikeProbabilities(values: number[]) {
  const sum = values.reduce((acc, value) => acc + value, 0);
  return values.every((value) => value >= 0 && value <= 1) && sum > 0.98 && sum < 1.02;
}

function normalize(values: number[]) {
  const sum = values.reduce((acc, value) => acc + value, 0) || 1;
  return values.map((value) => value / sum);
}

function softmax(values: number[]) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const sum = exps.reduce((acc, value) => acc + value, 0) || 1;
  return exps.map((value) => value / sum);
}

function unavailableScore(model: string): AestheticScore {
  return {
    score: 0,
    confidence: 0,
    model,
    modelVersion: MODEL_VERSION,
    modelAvailable: false,
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

function clamp(n: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n));
}
