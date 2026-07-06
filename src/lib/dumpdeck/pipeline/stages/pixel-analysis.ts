import { analyzeImage } from "../../ai";
import type { ImagePipelineStage } from "../types";

export const pixelAnalysisStage: ImagePipelineStage = {
  id: "pixel-analysis",
  version: "heuristic-canvas-v1",
  async run(context) {
    return {
      ...context,
      analysis: await analyzeImage(context.sourceUrl),
    };
  },
};
