export type QueueType =
  | "good"
  | "no_label"
  | "low_label"
  | "low_confidence"
  | "conflict"
  | "class_missing"
  | "unassigned";

export type ReviewStatus = "pending" | "approved" | "rejected";

export type JobStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface FirestoreProject {
  id: string;
  name: string;
  description: string | null;
  annotationType: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreClass {
  id: string;
  className: string;
  classIndex: number;
  color?: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreDataset {
  id: string;
  name: string;
  description?: string | null;
  totalImages: number;
  totalSizeBytes?: number;
  hfRepo?: string | null;
  hfFolderPath?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreImage {
  id: string;
  datasetId: string;
  fileName: string;
  hfRepo?: string | null;
  hfPath?: string | null;
  mimeType?: string | null;
  fileSize?: number;
  width?: number;
  height?: number;
  status: string;
  queueType: QueueType;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreModel {
  id: string;
  modelName: string;
  modelVersion: string;
  modelType: string;
  hfRepo?: string | null;
  hfPath?: string | null;
  classMapping?: Record<string, string>;
  fileSize?: number;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreAnnotation {
  id: string;
  imageId: string;
  jobId?: string | null;
  status: string;
  source: string;
  reviewStatus: ReviewStatus | null;
  reviewedAt?: string | null;
  autoLabeledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreAnnotationObject {
  id: string;
  annotationId: string;
  imageId: string;
  classId: string | null;
  classIndex: number;
  className: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  confidence: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreLabellingJob {
  id: string;
  datasetId: string;
  modelId: string;
  modelIds?: string[];
  confidenceThreshold: number;
  iouThreshold: number;
  imageSize: number;
  lowLabelThreshold: number;
  jobType: "auto_label" | "test_run" | "model_compare";
  status: JobStatus;
  progress: number;
  progressMessage?: string | null;
  totalItems: number;
  processedItems: number;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
}
