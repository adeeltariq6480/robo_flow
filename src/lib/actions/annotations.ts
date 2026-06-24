"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseAnnotations, serializeAnnotations } from "@/lib/annotations/coords";
import type {
  AnnotationBox,
  DatasetFileReview,
  ReviewFilter,
  ReviewStatus,
} from "@/lib/types/annotations";
import { revalidatePath } from "next/cache";

const IMAGE_MIME_PREFIX = "image/";

function reviewBase(projectId: string, datasetId: string) {
  return `/projects/${projectId}/datasets/${datasetId}/review`;
}

function mapFile(row: Record<string, unknown>): DatasetFileReview {
  return {
    id: String(row.id),
    dataset_id: String(row.dataset_id),
    project_id: String(row.project_id),
    file_name: String(row.file_name),
    file_path: String(row.file_path),
    mime_type: row.mime_type != null ? String(row.mime_type) : null,
    annotations: parseAnnotations(row.annotations),
    auto_labeled_at:
      row.auto_labeled_at != null ? String(row.auto_labeled_at) : null,
    review_status:
      row.review_status === "pending" ||
      row.review_status === "approved" ||
      row.review_status === "rejected"
        ? row.review_status
        : null,
    reviewed_at: row.reviewed_at != null ? String(row.reviewed_at) : null,
    created_at: String(row.created_at),
  };
}

function applyReviewFilter<T extends { eq: (col: string, val: string) => T }>(
  query: T,
  filter: ReviewFilter
): T {
  switch (filter) {
    case "needs_review":
      return query.eq("review_status", "pending");
    case "approved":
      return query.eq("review_status", "approved");
    case "rejected":
      return query.eq("review_status", "rejected");
    default:
      return query;
  }
}

export async function getDatasetReviewQueue(
  projectId: string,
  datasetId: string,
  filter: ReviewFilter = "all"
) {
  const supabase = createAdminClient();

  let query = supabase
    .from("dataset_files")
    .select(
      "id, dataset_id, project_id, file_name, file_path, mime_type, annotations, auto_labeled_at, review_status, reviewed_at, created_at"
    )
    .eq("project_id", projectId)
    .eq("dataset_id", datasetId)
    .like("mime_type", `${IMAGE_MIME_PREFIX}%`)
    .order("created_at", { ascending: true });

  query = applyReviewFilter(query, filter);

  const { data, error } = await query;
  if (error) return { error: error.message };

  let files = (data ?? []).map((row) => mapFile(row as Record<string, unknown>));

  if (filter === "unannotated") {
    files = files.filter((f) => f.annotations.length === 0);
  } else if (filter === "annotated") {
    files = files.filter((f) => f.annotations.length > 0);
  } else if (filter === "needs_review") {
    files = files.filter(
      (f) => f.review_status === "pending" || f.auto_labeled_at != null
    );
  }

  return { files };
}

export async function getDatasetFileForReview(
  projectId: string,
  datasetId: string,
  fileId: string
) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("dataset_files")
    .select(
      "id, dataset_id, project_id, file_name, file_path, mime_type, annotations, auto_labeled_at, review_status, reviewed_at, created_at"
    )
    .eq("id", fileId)
    .eq("project_id", projectId)
    .eq("dataset_id", datasetId)
    .single();

  if (error || !data) return { error: error?.message ?? "File not found" };

  const { data: signed, error: signError } = await supabase.storage
    .from("datasets")
    .createSignedUrl(data.file_path, 3600);

  if (signError || !signed?.signedUrl) {
    return { error: signError?.message ?? "Could not load image" };
  }

  return {
    file: mapFile(data as Record<string, unknown>),
    imageUrl: signed.signedUrl,
  };
}

export async function getSignedDatasetImageUrl(filePath: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from("datasets")
    .createSignedUrl(filePath, 3600);

  if (error || !data?.signedUrl) {
    return { error: error?.message ?? "Could not sign URL" };
  }
  return { url: data.signedUrl };
}

export async function saveAnnotations(
  projectId: string,
  datasetId: string,
  fileId: string,
  boxes: AnnotationBox[]
) {
  const supabase = createAdminClient();
  const payload = serializeAnnotations(boxes);

  const primaryClassId = boxes[0]?.project_class_id ?? null;

  const { error } = await supabase
    .from("dataset_files")
    .update({
      annotations: payload,
      class_id: primaryClassId,
    })
    .eq("id", fileId)
    .eq("project_id", projectId)
    .eq("dataset_id", datasetId);

  if (error) return { error: error.message };

  revalidatePath(reviewBase(projectId, datasetId));
  revalidatePath(`${reviewBase(projectId, datasetId)}/${fileId}`);
  return { success: true };
}

export async function setReviewStatus(
  projectId: string,
  datasetId: string,
  fileId: string,
  status: ReviewStatus,
  boxes?: AnnotationBox[]
) {
  const supabase = createAdminClient();

  const update: Record<string, unknown> = {
    review_status: status,
    reviewed_at: new Date().toISOString(),
  };

  if (boxes) {
    update.annotations = serializeAnnotations(boxes);
    update.class_id = boxes[0]?.project_class_id ?? null;
  }

  const { error } = await supabase
    .from("dataset_files")
    .update(update)
    .eq("id", fileId)
    .eq("project_id", projectId)
    .eq("dataset_id", datasetId);

  if (error) return { error: error.message };

  revalidatePath(reviewBase(projectId, datasetId));
  revalidatePath(`${reviewBase(projectId, datasetId)}/${fileId}`);
  return { success: true };
}

export async function getReviewCounts(
  projectId: string,
  datasetId: string
) {
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
