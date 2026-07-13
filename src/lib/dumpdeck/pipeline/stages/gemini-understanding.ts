import { analyzeImageUnderstandingWithGemini } from "../gemini-image-understanding";
import type { ImagePipelineStage } from "../types";

export const geminiUnderstandingStage: ImagePipelineStage = {
  id: "gemini-understanding",
  version: "gemini-flash-combined-v1",
  async run(context) {
    const result = await analyzeImageUnderstandingWithGemini(
      context.sourceUrl,
      context.item.mimeType,
      context.geminiRequestMeta,
    );
    return {
      ...context,
      sceneAnalysis: result.sceneAnalysis,
      detectedObjects: result.detectedObjects,
      faceAnalysis: result.faceAnalysis,
    };
  },
};
