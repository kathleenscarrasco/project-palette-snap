import type { Analysis, ImageQuality } from "../../types";
import type { ImagePipelineStage } from "../types";

export const imageQualityStage: ImagePipelineStage = {
  id: "image-quality",
  version: "technical-heuristics-v1",
  async run(context) {
    if (!context.analysis) {
      throw new Error("imageQualityStage requires pixel analysis");
    }

    return {
      ...context,
      imageQuality: estimateImageQuality(context.analysis),
    };
  },
};

function estimateImageQuality(analysis: Analysis): ImageQuality {
  const exposure = clamp(1 - Math.abs(analysis.brightness - 0.54) * 2.1);
  const underexposed = clamp((0.42 - analysis.brightness) * 2.4);
  const overexposed = clamp((analysis.brightness - 0.72) * 2.7);
  const sharpness = clamp(analysis.sharpness * 1.08);
  const motionBlur = clamp(1 - sharpness * 0.9 - analysis.contrast * 0.12);
  const contrast = clamp(analysis.contrast * 1.06);
  const saturation = clamp(analysis.saturation * 1.04);
  const noise = clamp(
    (1 - analysis.sharpness) * 0.24 +
      Math.abs(analysis.contrast - 0.42) * 0.12 +
      underexposed * 0.42 +
      overexposed * 0.18,
  );

  const overallTechnicalQuality = clamp(
    sharpness * 0.28 +
      (1 - motionBlur) * 0.18 +
      exposure * 0.2 +
      contrast * 0.13 +
      saturation * 0.08 +
      (1 - noise) * 0.13,
  );

  return {
    sharpness,
    motionBlur,
    exposure,
    contrast,
    saturation,
    noise,
    overallTechnicalQuality,
    signals: {
      brightness: analysis.brightness,
      edgeDetail: analysis.sharpness,
      underexposed,
      overexposed,
    },
    model: "technical-heuristics-v1",
  };
}

function clamp(n: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n));
}
