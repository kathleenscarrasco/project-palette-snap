export type Tag =
  | "Best lighting"
  | "Main character"
  | "Good filler"
  | "Too similar"
  | "Golden hour"
  | "Wide shot"
  | "Close up"
  | "Funny one"
  | "Soft & moody"
  | "Punchy color"
  | "People shot"
  | "Selfie"
  | "Group"
  | "Food"
  | "Landscape"
  | "Outfit"
  | "Detail"
  | "Random"
  | "Unsure"
  | "Good first slide"
  | "Good filler slide"
  | "Best ending";

export type Scores = {
  aesthetic: number;
  fun: number;
  postWorthy: number;
  unique: number;
  quality: number;
  lighting: number;
};

export type PhotoType = "selfie" | "group" | "food" | "landscape" | "outfit" | "detail" | "random";

export type Orientation = "portrait" | "square" | "landscape";

export type DetectionBox = { x: number; y: number; w: number; h: number; score: number };

export type Analysis = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  aHash: string;
  dHash: string;
  feature: number[];
  avgR: number;
  avgG: number;
  avgB: number;
  faceish: number;
  sharpness: number;
  detectedPeopleCount: number;
  detectedFaceCount: number;
  detectionConfidence: number;
  peopleUnsure: boolean;
  peopleBoxes?: DetectionBox[];
  faceBoxes?: DetectionBox[];
};

export type SceneAnalysis = {
  primaryScene: string;
  secondaryScene: string;
  indoorsOutdoors: "indoors" | "outdoors" | "mixed" | "unknown";
  confidenceScores: {
    primaryScene: number;
    secondaryScene: number;
    indoors: number;
    outdoors: number;
    food: number;
    landscape: number;
    beach: number;
    city: number;
    mountains: number;
    pets: number;
    vehicles: number;
    sports: number;
  };
  labels: {
    food: boolean;
    landscape: boolean;
    beach: boolean;
    city: boolean;
    mountains: boolean;
    pets: boolean;
    vehicles: boolean;
    sports: boolean;
  };
  model: string;
};

export type DetectedObject = {
  label: string;
  labelNormalized: string;
  confidence: number;
  box2d?: {
    ymin: number;
    xmin: number;
    ymax: number;
    xmax: number;
  };
  model: string;
};

export type FaceAnalysis = {
  numberOfFaces: number;
  croppedFaces: number;
  faces: {
    faceIndex: number;
    smiling: {
      value: boolean;
      confidence: number;
    };
    eyesOpen: {
      left: boolean;
      right: boolean;
      both: boolean;
      confidence: number;
    };
    approximateAgeGroup: {
      value: "baby" | "child" | "teen" | "young_adult" | "adult" | "older_adult" | "unknown";
      confidence: number;
    };
    headPose: {
      yaw: "left" | "center" | "right" | "unknown";
      pitch: "up" | "level" | "down" | "unknown";
      roll: "tilted_left" | "level" | "tilted_right" | "unknown";
      confidence: number;
    };
    faceVisibility: {
      value: "clear" | "partial" | "obscured" | "profile" | "unknown";
      confidence: number;
    };
    cropped: {
      value: boolean;
      confidence: number;
      edges: ("top" | "right" | "bottom" | "left")[];
    };
    box2d?: {
      ymin: number;
      xmin: number;
      ymax: number;
      xmax: number;
    };
  }[];
  model: string;
};

export type ImageQuality = {
  sharpness: number;
  motionBlur: number;
  exposure: number;
  contrast: number;
  saturation: number;
  noise: number;
  overallTechnicalQuality: number;
  signals: {
    brightness: number;
    edgeDetail: number;
    underexposed: number;
    overexposed: number;
  };
  model: string;
};

export type AestheticScore = {
  score: number;
  confidence: number;
  model: string;
  modelVersion: string;
  modelAvailable: boolean;
};

export type ClipImageEmbedding = {
  dimensions: number;
  model: string;
  modelVersion: string;
  modelAvailable: boolean;
  stored: boolean;
};

export type ImageRelationship =
  "Exact Duplicate" | "Near Duplicate" | "Same Moment" | "Same Event" | "Same Collection";

export type DuplicateAnalysis = {
  groupId: string;
  relationship: Extract<ImageRelationship, "Exact Duplicate" | "Near Duplicate"> | "";
  confidence: number;
  bestPhoto: boolean;
  reason: string;
};

export type EventAnalysis = {
  groupId: string;
  title: string;
  description: string;
  coverPhoto: string;
  photoCount: number;
  estimatedTimeRange?: string;
  estimatedLocation?: string;
};

export type CollectionAnalysis = {
  groupId: string;
  title: string;
  summary: string;
  coverPhoto: string;
  eventCount: number;
  photoCount: number;
  estimatedDateRange?: string;
};

export type PhotoRanking = {
  keepScore: number;
  deleteScore: number;
  confidence: number;
  explanation: string;
  recommendation: "keep" | "delete";
  bestInDuplicateCluster: boolean;
  duplicateClusterBestPhotoId?: string;
  duplicateClusterRank: number;
  overallRank: number;
  overallScore: number;
  model: string;
  modelVersion: string;
  signals: {
    technical: number;
    aesthetic: number;
    face: number;
    scene: number;
    object: number;
    tagMatch: number;
    diversity: number;
    duplicatePenalty: number;
  };
  scoreBreakdown?: {
    technical: number;
    aesthetic: number;
    people: number;
    sceneTagMatch: number;
    objectTagMatch: number;
    final: number;
    tagBoost: number;
    selectedTags: VibeFocus[];
  };
};

export type UnifiedImageAnalysis = {
  analysisVersion: 1;
  analysis: {
    scene: string;
    subscene: string;
    objects: {
      label: string;
      normalizedLabel: string;
      confidence: number;
    }[];
    peopleCount: number;
    faces: FaceAnalysis["faces"];
    orientation: Orientation;
    technicalQuality: {
      sharpness: number;
      blur: number;
      brightness: number;
      contrast: number;
      saturation: number;
      noise: number;
      overall: number;
    };
    aestheticScore: number;
    imageEmbeddingId: string;
    duplicateCluster: string;
    rankingScore: number;
    keepRecommendation: boolean;
    confidence: number;
    reasoning: string;
    duplicate: DuplicateAnalysis;
    event: EventAnalysis;
    collection: CollectionAnalysis;
    bestInDuplicateCluster: boolean;
    duplicateClusterBestPhotoId?: string;
    overallRank: number;
    modelTrace: {
      scene?: string;
      objects?: string[];
      faces?: string;
      quality?: string;
      aesthetic?: string;
      embedding?: string;
      ranking?: string;
    };
  };
};

export type Photo = {
  id: string;
  fingerprint?: string;
  lastModified?: number;
  url: string;
  originalFileUrl?: string;
  previewFileUrl?: string;
  previewUrl?: string;
  storageBucket?: string;
  originalStoragePath?: string;
  previewStoragePath?: string;
  fileName?: string;
  uploadedAt?: string;
  name: string;
  width: number;
  height: number;
  scores: Scores;
  overall: number;
  tags: Tag[];
  reasons: string[];
  group: number;
  photoType: PhotoType;
  photoTypeConfidence: number;
  peopleCount: 0 | 1 | 2 | 3 | 4;
  peopleConfidence: number;
  orientation: Orientation;
  analysis: Analysis;
  sceneAnalysis?: SceneAnalysis;
  detectedObjects?: DetectedObject[];
  faceAnalysis?: FaceAnalysis;
  imageQuality?: ImageQuality;
  aestheticScore?: AestheticScore;
  clipEmbedding?: ClipImageEmbedding;
  duplicateClusterId?: string;
  duplicateRelationship?: DuplicateAnalysis;
  eventGroup?: EventAnalysis;
  collectionGroup?: CollectionAnalysis;
  ranking?: PhotoRanking;
  unifiedAnalysis?: UnifiedImageAnalysis;
  kept?: boolean;
  sourceMetadata?: ImageSourceMetadata;
};

export type ImageSourceMetadata = {
  originalFileUrl?: string;
  previewFileUrl?: string;
  originalMimeType?: string;
  mimeType?: string;
  storageBucket?: string;
  originalStoragePath?: string;
  previewStoragePath?: string;
  fileName?: string;
  uploadedAt?: string;
  convertedFromHeic?: boolean;
  conversionQuality?: number;
  conversionDecoder?: string;
  originalByteSize?: number;
  previewByteSize?: number;
};

export type UploadItem = {
  id: string;
  url: string;
  originalFileUrl?: string;
  previewFileUrl?: string;
  previewUrl?: string;
  storageBucket?: string;
  originalStoragePath?: string;
  previewStoragePath?: string;
  fileName?: string;
  uploadedAt?: string;
  name: string;
  width: number;
  height: number;
  fingerprint?: string;
  byteSize?: number;
  mimeType?: string;
  originalMimeType?: string;
  convertedFromHeic?: boolean;
  conversionQuality?: number;
  conversionDecoder?: string;
  originalByteSize?: number;
  previewByteSize?: number;
  lastModified?: number;
};

export type AnalysisStatus =
  | "uploaded"
  | "queued"
  | "analyzing"
  | "retrying"
  | "analyzed"
  | "failed"
  | "local_scanning"
  | "local_complete"
  | "skipped";

export type PostFormat = "square" | "portrait" | "landscape" | "story";
export type VibeFocus = "cute" | "aesthetic" | "funny" | "vacation" | "food" | "friends" | "random";

export type Settings = {
  formats: PostFormat[];
  vibes: VibeFocus[];
};

export type RemovedPhoto = {
  photo: Photo;
  reason: string;
  source: "ai" | "user";
  similarToId?: string;
};

export type Stage =
  "setup" | "upload" | "analyze" | "similar" | "results" | "curate" | "final" | "export";
