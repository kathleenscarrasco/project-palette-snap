import { predictAestheticScore } from "../tfjs-aesthetic-predictor";
import type { ImagePipelineStage } from "../types";

export const aestheticScoringStage: ImagePipelineStage = {
  id: "aesthetic-scoring",
  version: "tfjs-aesthetic-v1",
  async run(context) {
    return {
      ...context,
      aestheticScore: await predictAestheticScore(context.sourceUrl),
    };
  },
};
