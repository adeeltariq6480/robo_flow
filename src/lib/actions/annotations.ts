"use server";

import * as annotationService from "@/lib/services/annotationService";
import type {
  AnnotationBox,
  ReviewFilter,
  ReviewStatus,
} from "@/lib/types/annotations";
import { revalidatePath } from "next/cache";

const reviewBase = (projectId: string, datasetId: string) =>
  `/projects/${projectId}/datasets/${datasetId}/review`;

export async function getDatasetReviewQueue(
  projectId: string,
  datasetId: string,
  filter: ReviewFilter = "all"
) {
  try {
    const files = await annotationService.getDatasetReviewQueue(
      projectId,
      datasetId,
      filter
    );
    return { files };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to load queue" };
  }
}

export async function getDatasetFileForReview(
  projectId: string,
  datasetId: string,
  fileId: string
) {
  return annotationService.getDatasetFileForReview(
    projectId,
    datasetId,
    fileId
  );
}

export async function getSignedDatasetImageUrl(
  projectId: string,
  imageId: string
) {
  try {
    const url = annotationService.getSignedImageUrl(projectId, imageId);
    return { url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load image URL" };
  }
}

export async function saveAnnotations(
  projectId: string,
  datasetId: string,
  fileId: string,
  boxes: AnnotationBox[]
) {
  const result = await annotationService.saveAnnotations(
    projectId,
    datasetId,
    fileId,
    boxes
  );
  revalidatePath(reviewBase(projectId, datasetId));
  revalidatePath(`${reviewBase(projectId, datasetId)}/${fileId}`);
  return result;
}

export async function setReviewStatus(
  projectId: string,
  datasetId: string,
  fileId: string,
  status: ReviewStatus,
  boxes?: AnnotationBox[]
) {
  const result = await annotationService.setReviewStatus(
    projectId,
    datasetId,
    fileId,
    status,
    boxes
  );
  revalidatePath(reviewBase(projectId, datasetId));
  revalidatePath(`${reviewBase(projectId, datasetId)}/${fileId}`);
  return result;
}

export async function bulkSetReviewStatus(
  projectId: string,
  datasetId: string,
  fileIds: string[],
  status: ReviewStatus
) {
  const result = await annotationService.bulkSetReviewStatus(
    projectId,
    datasetId,
    fileIds,
    status
  );
  revalidatePath(reviewBase(projectId, datasetId));
  return result;
}

export async function getReviewCounts(projectId: string, datasetId: string) {
  const result = await getDatasetReviewQueue(projectId, datasetId, "all");
  if (result.error || !result.files) return { error: result.error };

  const files = result.files;
  return {
    counts: {
      all: files.length,
      needs_review: files.filter(
        (f) => f.review_status === "pending" || f.auto_labeled_at != null
      ).length,
      unannotated: files.filter((f) => f.annotations.length === 0).length,
      annotated: files.filter((f) => f.annotations.length > 0).length,
      approved: files.filter((f) => f.review_status === "approved").length,
      rejected: files.filter((f) => f.review_status === "rejected").length,
    },
  };
}
