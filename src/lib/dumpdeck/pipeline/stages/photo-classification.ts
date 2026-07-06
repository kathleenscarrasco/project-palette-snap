import { classifyPhoto } from "../../ai";
import type { ImagePipelineStage } from "../types";

export const photoClassificationStage: ImagePipelineStage = {
  id: "photo-classification",
  version: "heuristic-classifier-v1",
  async run(context) {
    if (!context.analysis) {
      throw new Error("photoClassificationStage requires analysis");
    }

    return {
      ...context,
      classification: classifyPhoto(context.item.width, context.item.height, context.analysis),
    };
  },
};
