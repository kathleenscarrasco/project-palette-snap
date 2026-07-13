# Image Analysis Pipeline

This folder owns the AI image-analysis boundary for the app.

Each model capability is implemented as a replaceable `ImagePipelineStage` with a single responsibility:

- `scene-analysis`: scene and subscene recognition
- `object-detection`: object labels and confidence scores
- `face-analysis`: face attributes and visibility
- `image-quality`: technical quality metrics
- `aesthetic-scoring`: dedicated aesthetic model score
- `clip-embedding`: image embeddings for vector search
- `duplicate-clustering`: embedding-based duplicate clusters
- `ranking-engine`: final keep/delete ranking from metadata only

Stages may store normalized data for filtering and vector search, but UI consumers should read `photo.unifiedAnalysis`.
That versioned envelope is built in `unified-analysis.ts` and is the frontend-facing analysis API.

Provider-specific code should stay behind stage modules or adapter files. To swap Gemini, CLIP, YOLO, Google Vision,
OpenAI, or another model, keep the stage output type stable and replace only the adapter implementation.
