import {
  bucketName,
  getAdminDb,
  getAdminStorage,
  nowIso,
} from "@/lib/firebase/admin";
import {
  boxToMinMax,
  objectsToBoxes,
  toDatasetFileReview,
} from "@/lib/firebase/adapters";
import { projectSub } from "@/lib/firebase/paths";
import type {
  FirestoreAnnotation,
  FirestoreAnnotationObject,
  FirestoreImage,
  ReviewStatus,
} from "@/lib/types/firestore";
import type { AnnotationBox, ReviewFilter } from "@/lib/types/annotations";
import type { DatasetFileReview } from "@/lib/types/annotations";

const IMAGE_MIME_PREFIX = "image/";

function imagesRef(projectId: string) {
  return getAdminDb().collection(projectSub(projectId, "images"));
}

function annotationsRef(projectId: string) {
  return getAdminDb().collection(projectSub(projectId, "annotations"));
}

function objectsRef(projectId: string) {
  return getAdminDb().collection(projectSub(projectId, "annotationObjects"));
}

async function getAnnotationForImage(
  projectId: string,
  imageId: string
): Promise<FirestoreAnnotation | null> {
  const snap = await annotationsRef(projectId)
    .where("imageId", "==", imageId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return { id: doc.id, ...(doc.data() as Omit<FirestoreAnnotation, "id">) };
}

async function getObjectsForImage(
  projectId: string,
  imageId: string
): Promise<FirestoreAnnotationObject[]> {
  const snap = await objectsRef(projectId)
    .where("imageId", "==", imageId)
    .get();
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<FirestoreAnnotationObject, "id">),
  }));
}

async function buildReviewFile(
  projectId: string,
  image: FirestoreImage
): Promise<DatasetFileReview> {
  const annotation = await getAnnotationForImage(projectId, image.id);
  const objects = await getObjectsForImage(projectId, image.id);
  return toDatasetFileReview(projectId, image, annotation, objects);
}

export async function getDatasetReviewQueue(
  projectId: string,
  datasetId: string,
  filter: ReviewFilter = "all"
): Promise<DatasetFileReview[]> {
  const snap = await imagesRef(projectId)
    .where("datasetId", "==", datasetId)
    .get();

  const images = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<FirestoreImage, "id">) }))
    .filter(
      (img) =>
        !img.mimeType || img.mimeType.startsWith(IMAGE_MIME_PREFIX)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const files = await Promise.all(
    images.map((img) => buildReviewFile(projectId, img))
  );

  return applyReviewFilter(files, filter);
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

export async function getDatasetFileForReview(
  projectId: string,
  datasetId: string,
  fileId: string
) {
  const snap = await imagesRef(projectId).doc(fileId).get();
  if (!snap.exists) return { error: "File not found" };

  const image = {
    id: snap.id,
    ...(snap.data() as Omit<FirestoreImage, "id">),
  };
  if (image.datasetId !== datasetId) return { error: "File not found" };

  const file = await buildReviewFile(projectId, image);
  const imageUrl = image.downloadUrl || (await getSignedImageUrl(image.storagePath));

  return { file, imageUrl };
}

export async function getSignedImageUrl(storagePath: string): Promise<string> {
  const bucket = getAdminStorage().bucket(bucketName());
  const file = bucket.file(storagePath);
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 3600 * 1000,
  });
  return url;
}

export async function saveAnnotations(
  projectId: string,
  datasetId: string,
  imageId: string,
  boxes: AnnotationBox[]
) {
  try {
    await upsertAnnotationObjects(projectId, imageId, boxes, "manual");
    return { success: true as const };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function setReviewStatus(
  projectId: string,
  datasetId: string,
  imageId: string,
  status: ReviewStatus,
  boxes?: AnnotationBox[]
) {
  try {
    if (boxes) {
      await upsertAnnotationObjects(projectId, imageId, boxes, "manual");
    }

    const now = nowIso();
    const existing = await getAnnotationForImage(projectId, imageId);

    if (existing) {
      await annotationsRef(projectId).doc(existing.id).update({
        reviewStatus: status,
        reviewedAt: now,
        updatedAt: now,
      });
    } else {
      await annotationsRef(projectId).add({
        imageId,
        status: "active",
        source: "manual",
        reviewStatus: status,
        reviewedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true as const };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Update failed" };
  }
}

async function upsertAnnotationObjects(
  projectId: string,
  imageId: string,
  boxes: AnnotationBox[],
  source: string
) {
  const db = getAdminDb();
  const now = nowIso();

  const existingAnn = await getAnnotationForImage(projectId, imageId);
  let annotationId: string;

  if (existingAnn) {
    annotationId = existingAnn.id;
    await annotationsRef(projectId).doc(annotationId).update({
      updatedAt: now,
      source,
    });
  } else {
    const ref = await annotationsRef(projectId).add({
      imageId,
      status: "active",
      source,
      reviewStatus: null,
      createdAt: now,
      updatedAt: now,
    });
    annotationId = ref.id;
  }

  const oldObjects = await objectsRef(projectId)
    .where("imageId", "==", imageId)
    .get();
  const batch = db.batch();
  oldObjects.docs.forEach((d) => batch.delete(d.ref));

  for (const box of boxes) {
    const { xMin, yMin, xMax, yMax } = boxToMinMax(box);
    const ref = objectsRef(projectId).doc();
    batch.set(ref, {
      annotationId,
      imageId,
      classId: box.project_class_id,
      classIndex: 0,
      className: box.class_name,
      xMin,
      yMin,
      xMax,
      yMax,
      confidence: box.confidence,
      source,
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();
}

export async function getApprovedExportFiles(projectId: string, datasetId: string) {
  const images = await imagesRef(projectId)
    .where("datasetId", "==", datasetId)
    .get();

  const approved: {
    id: string;
    fileName: string;
    storagePath: string;
    downloadUrl: string;
    mimeType: string | null;
    annotations: AnnotationBox[];
  }[] = [];

  for (const doc of images.docs) {
    const image = {
      id: doc.id,
      ...(doc.data() as Omit<FirestoreImage, "id">),
    };
    if (image.mimeType && !image.mimeType.startsWith(IMAGE_MIME_PREFIX)) continue;

    const annotation = await getAnnotationForImage(projectId, image.id);
    if (annotation?.reviewStatus !== "approved") continue;

    const objects = await getObjectsForImage(projectId, image.id);
    approved.push({
      id: image.id,
      fileName: image.fileName,
      storagePath: image.storagePath,
      downloadUrl: image.downloadUrl,
      mimeType: image.mimeType ?? null,
      annotations: objectsToBoxes(objects),
    });
  }

  return approved;
}
