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

export type PhotoType =
  | "selfie"
  | "group"
  | "food"
  | "landscape"
  | "outfit"
  | "detail"
  | "random";

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

export type Photo = {
  id: string;
  url: string;
  previewUrl?: string;
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
  kept?: boolean;
};


export type PostFormat = "square" | "portrait" | "landscape" | "story";
export type VibeFocus =
  | "cute"
  | "aesthetic"
  | "funny"
  | "vacation"
  | "food"
  | "friends"
  | "random";

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
  | "setup"
  | "upload"
  | "analyze"
  | "similar"
  | "results"
  | "curate"
  | "final"
  | "export";
