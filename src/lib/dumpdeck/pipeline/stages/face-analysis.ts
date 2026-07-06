import { analyzeFacesWithGemini } from "../gemini-face-analysis";
import type { ImagePipelineStage } from "../types";

export const faceAnalysisStage: ImagePipelineStage = {
  id: "face-analysis",
  version: "gemini-flash-v1",
  async run(context) {
    return {
      ...context,
      faceAnalysis: await analyzeFacesWithGemini(context.sourceUrl, context.item.mimeType),
    };
  },
};
