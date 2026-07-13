import { generateClipImageEmbedding } from "../tfjs-clip-embeddings";
import type { ImagePipelineStage } from "../types";

export const clipEmbeddingStage: ImagePipelineStage = {
  id: "clip-embedding",
  version: "tfjs-clip-image-v1",
  async run(context) {
    const result = await generateClipImageEmbedding(context.sourceUrl);
    return {
      ...context,
      clipEmbedding: result.metadata,
      clipEmbeddingVector: result.vector,
    };
  },
};
