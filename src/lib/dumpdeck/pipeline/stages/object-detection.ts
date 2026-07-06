import { detectObjectsWithGemini } from "../gemini-object-detection";
import type { ImagePipelineStage } from "../types";

export const objectDetectionStage: ImagePipelineStage = {
  id: "object-detection",
  version: "gemini-flash-v1",
  async run(context) {
    return {
      ...context,
      detectedObjects: await detectObjectsWithGemini(context.sourceUrl, context.item.mimeType),
    };
  },
};
