import { scorePhoto } from "../../ai";
import type { ImagePipelineStage } from "../types";

export const photoScoringStage: ImagePipelineStage = {
  id: "photo-scoring",
  version: "vibe-format-scorer-v1",
  async run(context) {
    if (!context.analysis || !context.classification) {
      throw new Error("photoScoringStage requires analysis and classification");
    }

    return {
      ...context,
      scoring: scorePhoto(
        {
          width: context.item.width,
          height: context.item.height,
          analysis: context.analysis,
        },
        context.classification,
        context.settings,
      ),
    };
  },
};
