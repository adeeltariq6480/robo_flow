import type { AnnotationBox } from "@/lib/types/annotations";
import type {
  FirestoreAnnotation,
  FirestoreAnnotationObject,
  FirestoreClass,
  FirestoreDataset,
  FirestoreImage,
  FirestoreModel,
  FirestoreProject,
} from "@/lib/types/firestore";
import type { Class, Dataset, DatasetFile, Model, Project } from "@/lib/types/database";

/** Map Firestore project → legacy Project type for existing UI. */
export function toProject(doc: FirestoreProject): Project {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    created_by: doc.createdBy ?? "",
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

export function toClass(projectId: string, doc: FirestoreClass): Class {
  const rawName = doc.className as unknown;
  const name = Array.isArray(rawName)
    ? rawName.map((v) => String(v)).filter(Boolean).join(", ")
    : String(rawName ?? "unknown");

  const rawIndex = doc.classIndex as unknown;
  let sortOrder = 0;
  if (Array.isArray(rawIndex)) {
    sortOrder = Number(rawIndex[0]) || 0;
  } else {
    sortOrder = Number(rawIndex ?? 0);
    if (!Number.isFinite(sortOrder)) sortOrder = 0;
  }

  const rawDesc = doc.description as unknown;
  const description = Array.isArray(rawDesc)
    ? rawDesc.map((v) => String(v)).join(", ")
    : doc.description ?? null;

  return {
    id: doc.id,
    project_id: projectId,
    name,
    color: doc.color ?? "#6366f1",
    description,
    sort_order: sortOrder,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

export function toDataset(projectId: string, doc: FirestoreDataset): Dataset {
  return {
    id: doc.id,
    project_id: projectId,
    name: doc.name,
    description: doc.description ?? null,
    file_count: doc.totalImages,
    total_size_bytes: doc.totalSizeBytes ?? 0,
    created_by: "",
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

export function toModel(projectId: string, doc: FirestoreModel): Model {
  const format = (doc.modelType as Model["format"]) || "pytorch";
  return {
    id: doc.id,
    project_id: projectId,
    name: doc.modelName,
    description: doc.description ?? null,
    file_path: doc.hfPath ?? "",
    file_size: doc.fileSize ?? 0,
    format,
    version: doc.modelVersion,
    created_by: "",
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

/** Convert YOLO normalized box to axis-aligned min/max. */
export function boxToMinMax(box: Pick<AnnotationBox, "x" | "y" | "width" | "height">) {
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  return {
    xMin: Math.max(0, box.x - halfW),
    yMin: Math.max(0, box.y - halfH),
    xMax: Math.min(1, box.x + halfW),
    yMax: Math.min(1, box.y + halfH),
  };
}

/** Convert min/max back to YOLO normalized center format. */
export function minMaxToBox(
  o: Pick<FirestoreAnnotationObject, "xMin" | "yMin" | "xMax" | "yMax">
): Pick<AnnotationBox, "x" | "y" | "width" | "height"> {
  const width = o.xMax - o.xMin;
  const height = o.yMax - o.yMin;
  return {
    x: o.xMin + width / 2,
    y: o.yMin + height / 2,
    width,
    height,
  };
}

export function objectsToBoxes(objects: FirestoreAnnotationObject[]): AnnotationBox[] {
  return objects.map((o) => ({
    id: o.id,
    class_name: o.className,
    project_class_id: o.classId,
    confidence: o.confidence,
    ...minMaxToBox(o),
  }));
}

export function toDatasetFile(
  projectId: string,
  image: FirestoreImage,
  annotation: FirestoreAnnotation | null,
  objects: FirestoreAnnotationObject[]
): DatasetFile {
  return {
    id: image.id,
    dataset_id: image.datasetId,
    project_id: projectId,
    class_id: objects[0]?.classId ?? null,
    file_name: image.fileName,
    file_path: image.hfPath ?? "",
    file_size: image.fileSize ?? 0,
    mime_type: image.mimeType ?? null,
    annotations: objectsToBoxes(objects) as unknown as DatasetFile["annotations"],
    auto_labeled_at: annotation?.autoLabeledAt ?? null,
    review_status: annotation?.reviewStatus ?? null,
    reviewed_at: annotation?.reviewedAt ?? null,
    created_at: image.createdAt,
  };
}

export function toDatasetFileReview(
  projectId: string,
  image: FirestoreImage,
  annotation: FirestoreAnnotation | null,
  objects: FirestoreAnnotationObject[]
): import("@/lib/types/annotations").DatasetFileReview {
  const file = toDatasetFile(projectId, image, annotation, objects);
  return {
    id: file.id,
    dataset_id: file.dataset_id,
    project_id: file.project_id,
    file_name: file.file_name,
    file_path: file.file_path,
    mime_type: file.mime_type,
    annotations: objectsToBoxes(objects),
    auto_labeled_at: file.auto_labeled_at,
    review_status: file.review_status,
    reviewed_at: file.reviewed_at,
    created_at: file.created_at,
  };
}
