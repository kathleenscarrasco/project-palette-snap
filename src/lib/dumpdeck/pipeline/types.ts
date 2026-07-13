import type {
  Analysis,
  AestheticScore,
  ClipImageEmbedding,
  DetectedObject,
  FaceAnalysis,
  ImageQuality,
  Orientation,
  Photo,
  PhotoType,
  Scores,
  SceneAnalysis,
  Settings,
  Tag,
  UnifiedImageAnalysis,
  UploadItem,
  ImageSourceMetadata,
} from "../types";

export type ImagePipelineInput = UploadItem & {
  settings: Settings;
  geminiRequestMeta?: {
    photoId?: string;
    photoName?: string;
    reason?: string;
    retryCount?: number;
  };
};

export type ImageClassification = {
  photoType: PhotoType;
  photoTypeConfidence: number;
  peopleCount: 0 | 1 | 2 | 3 | 4;
  peopleConfidence: number;
  orientation: Orientation;
  peopleUnsure: boolean;
};

export type ImageScoring = {
  scores: Scores;
  overall: number;
  tags: Tag[];
  reasons: string[];
};

export type ImagePipelineContext = {
  item: UploadItem;
  settings: Settings;
  sourceUrl: string;
  geminiRequestMeta?: ImagePipelineInput["geminiRequestMeta"];
  analysis?: Analysis;
  classification?: ImageClassification;
  scoring?: ImageScoring;
  sceneAnalysis?: SceneAnalysis;
  detectedObjects?: DetectedObject[];
  faceAnalysis?: FaceAnalysis;
  imageQuality?: ImageQuality;
  aestheticScore?: AestheticScore;
  clipEmbedding?: ClipImageEmbedding;
  clipEmbeddingVector?: number[];
  unifiedAnalysis?: UnifiedImageAnalysis;
  sourceMetadata?: ImageSourceMetadata;
};

export type ImagePipelineStage = {
  id: string;
  version: string;
  run: (context: ImagePipelineContext) => Promise<ImagePipelineContext>;
};

export type CachedImageMetadata = {
  fingerprint: string;
  pipelineVersion: string;
  analysis: Analysis;
  classification: ImageClassification;
  sceneAnalysis: SceneAnalysis;
  detectedObjects: DetectedObject[];
  faceAnalysis: FaceAnalysis;
  imageQuality: ImageQuality;
  aestheticScore: AestheticScore;
  clipEmbedding: ClipImageEmbedding;
  clipEmbeddingVector?: number[];
  unifiedAnalysis?: UnifiedImageAnalysis;
  detectedObjectCount?: number;
  sourceMetadata?: ImageSourceMetadata;
};

export type CompletedPipelineResult = {
  photo: Photo;
  cache: "hit" | "miss" | "skipped";
  clipEmbeddingVector?: number[];
};
