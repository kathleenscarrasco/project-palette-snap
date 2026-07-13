import { detectPeopleAndFaces } from "../../detection";
import type { ImagePipelineStage } from "../types";

export const peopleDetectionStage: ImagePipelineStage = {
  id: "people-detection",
  version: "coco-ssd-lite-mediapipe-face-v1",
  async run(context) {
    if (!context.analysis) {
      throw new Error("peopleDetectionStage requires pixel analysis to run first");
    }

    const detection = await detectPeopleAndFaces(context.sourceUrl);
    return {
      ...context,
      analysis: {
        ...context.analysis,
        detectedPeopleCount: detection.detectedPeopleCount,
        detectedFaceCount: detection.detectedFaceCount,
        detectionConfidence: detection.confidence,
        peopleUnsure: detection.unsure,
        peopleBoxes: detection.peopleBoxes,
        faceBoxes: detection.faceBoxes,
      },
    };
  },
};
