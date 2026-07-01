import { api, imageContentUrl } from "@/lib/api/client";
import { boxToMinMax, toDatasetFileReview } from "@/lib/firebase/adapters";
import type {
  FirestoreAnnotation,
  FirestoreAnnotationObject,
  FirestoreImage,
  ReviewStatus,
} from "@/lib/types/firestore";
import type {
  AnnotationBox,
  DatasetFileReview,
  ReviewFilter,
} from "@/lib/types/annotations";

const IMAGE_MIME_PREFIX = "image/";

interface ReviewRow {
  image: FirestoreImage;
  annotation: FirestoreAnnotation | null;
  objects: FirestoreAnnotationObject[];
}

function boxesToObjects(boxes: AnnotationBox[]) {
  return boxes.map((box) => {
    const { xMin, yMin, xMax, yMax } = boxToMinMax(box);
    return {
      classId: box.project_class_id ?? null,
      classIndex: 0,
      className: box.class_name,
      xMin,
      yMin,
      xMax,
      yMax,
      confidence: box.confidence ?? 1,
    };
  });
}

function applyReviewFilter(
  files: DatasetFileReview[],
  filter: ReviewFilter
): DatasetFileReview[] {
  switch (filter) {
    case "needs_review":
      return files.filter(
        (f) => f.review_status === "pending" || f.auto_labeled_at != null
      );
    case "unannotated":
      return files.filter((f) => f.annotations.length === 0);
    case "annotated":
      return files.filter((f) => f.annotations.length > 0);
    case "approved":
      return files.filter((f) => f.review_status === "approved");
    case "rejected":
      return files.filter((f) => f.review_status === "rejected");
    default:
      return files;
  }
}

export async function getDatasetReviewQueue(
  projectId: string,
  datasetId: string,
  filter: ReviewFilter = "all"
): Promise<DatasetFileReview[]> {
  const rows = await api.get<ReviewRow[]>(
    `/api/datasets/${projectId}/${datasetId}/review`
  );
  const files = rows
    .filter(
      (r) => !r.image.mimeType || r.image.mimeType.startsWith(IMAGE_MIME_PREFIX)
    )
    .map((r) =>
      toDatasetFileReview(projectId, r.image, r.annotation, r.objects)
    );
  return applyReviewFilter(files, filter);
}

export async function getDatasetFileForReview(
  projectId: string,
  datasetId: string,
  fileId: string
) {
  try {
    const row = await api.get<ReviewRow>(
      `/api/annotations/${projectId}/${fileId}`
    );
    if (row.image.datasetId !== datasetId) return { error: "File not found" };
    const file = toDatasetFileReview(
      projectId,
      row.image,
      row.annotation,
      row.objects
    );
    return { file, imageUrl: imageContentUrl(projectId, fileId) };
  } catch {
    return { error: "File not found" };
  }
}

export function getSignedImageUrl(projectId: string, imageId: string): string {
  return imageContentUrl(projectId, imageId);
}

export async function saveAnnotations(
  projectId: string,
  _datasetId: string,
  imageId: string,
  boxes: AnnotationBox[]
) {
  try {
    await api.put(`/api/annotations/${projectId}/${imageId}`, {
      objects: boxesToObjects(boxes),
    });
    return { success: true as const };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function setReviewStatus(
  projectId: string,
  _datasetId: string,
  imageId: string,
  status: ReviewStatus,
  boxes?: AnnotationBox[]
) {
  try {
    if (boxes) {
      await api.put(`/api/annotations/${projectId}/${imageId}`, {
        objects: boxesToObjects(boxes),
      });
    }
    if (status === "approved") {
      await api.post("/api/approve-image", { projectId, imageId });
    } else if (status === "rejected") {
      await api.post("/api/reject-image", { projectId, imageId });
    }
    return { success: true as const };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function bulkSetReviewStatus(
  projectId: string,
  datasetId: string,
  imageIds: string[],
  status: ReviewStatus
) {
  for (const imageId of imageIds) {
    const result = await setReviewStatus(projectId, datasetId, imageId, status);
    if (result.error) return result;
  }
  return { success: true as const, count: imageIds.length };
}
