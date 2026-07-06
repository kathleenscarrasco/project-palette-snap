import { analyzeSceneWithGemini } from "../gemini-scene-analysis";
import type { ImagePipelineStage } from "../types";

export const sceneAnalysisStage: ImagePipelineStage = {
  id: "scene-analysis",
  version: "gemini-flash-v1",
  async run(context) {
    return {
      ...context,
      sceneAnalysis: await analyzeSceneWithGemini(context.sourceUrl, context.item.mimeType),
    };
  },
};
