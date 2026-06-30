export type ReviewStatus = "pending" | "approved" | "rejected";

export type ReviewFilter =
  | "all"
  | "needs_review"
  | "unannotated"
  | "annotated"
  | "approved"
  | "rejected";

export interface AnnotationBox {
  id: string;
  class_name: string;
  project_class_id: string | null;
  confidence: number;
  /** YOLO normalized center x */
  x: number;
  /** YOLO normalized center y */
  y: number;
  width: number;
  height: number;
}

export interface DatasetFileReview {
  id: string;
  dataset_id: string;
  project_id: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  annotations: AnnotationBox[];
  auto_labeled_at: string | null;
  review_status: ReviewStatus | null;
  reviewed_at: string | null;
  created_at: string;
}

export const REVIEW_FILTER_LABELS: Record<ReviewFilter, string> = {
  all: "All files",
  needs_review: "Needs review",
  unannotated: "Unannotated",
  annotated: "Annotated",
  approved: "Approved",
  rejected: "Rejected",
};
