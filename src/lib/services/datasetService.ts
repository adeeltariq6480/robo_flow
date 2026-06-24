import {
  bucketName,
  getAdminDb,
  getAdminStorage,
  nowIso,
} from "@/lib/firebase/admin";
import { toDataset } from "@/lib/firebase/adapters";
import { projectSub } from "@/lib/firebase/paths";
import type { FirestoreDataset, FirestoreImage } from "@/lib/types/firestore";
import type { Dataset } from "@/lib/types/database";

function datasetsRef(projectId: string) {
  return getAdminDb().collection(projectSub(projectId, "datasets"));
}

function imagesRef(projectId: string) {
  return getAdminDb().collection(projectSub(projectId, "images"));
}

export async function listDatasets(projectId: string): Promise<Dataset[]> {
  const snap = await datasetsRef(projectId)
    .orderBy("createdAt", "desc")
    .get();
  return snap.docs.map((doc) =>
    toDataset(projectId, {
      id: doc.id,
      ...(doc.data() as Omit<FirestoreDataset, "id">),
    })
  );
}

export async function listDatasetsBrief(projectId: string) {
  const snap = await datasetsRef(projectId).select("name").get();
  return snap.docs.map((d) => ({ id: d.id, name: d.data().name as string }));
}

export async function getDataset(
  projectId: string,
  datasetId: string
): Promise<Dataset | null> {
  const snap = await datasetsRef(projectId).doc(datasetId).get();
  if (!snap.exists) return null;
  return toDataset(projectId, {
    id: snap.id,
    ...(snap.data() as Omit<FirestoreDataset, "id">),
  });
}

export async function createDataset(
  projectId: string,
  data: { name: string; description?: string | null }
): Promise<string> {
  const now = nowIso();
  const ref = datasetsRef(projectId).doc();
  const doc: Omit<FirestoreDataset, "id"> = {
    name: data.name,
    description: data.description ?? null,
    totalImages: 0,
    totalSizeBytes: 0,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  await touchProject(projectId);
  return ref.id;
}

export async function registerImages(
  projectId: string,
  datasetId: string,
  files: {
    fileName: string;
    storagePath: string;
    downloadUrl: string;
    fileSize: number;
    mimeType: string;
  }[]
) {
  const db = getAdminDb();
  const batch = db.batch();
  const now = nowIso();
  let addedSize = 0;

  for (const f of files) {
    const ref = imagesRef(projectId).doc();
    const doc: Omit<FirestoreImage, "id"> = {
      datasetId,
      fileName: f.fileName,
      storagePath: f.storagePath,
      downloadUrl: f.downloadUrl,
      mimeType: f.mimeType,
      fileSize: f.fileSize,
      status: "active",
      queueType: "unassigned",
      createdAt: now,
      updatedAt: now,
    };
    batch.set(ref, doc);
    addedSize += f.fileSize;
  }

  await batch.commit();

  const datasetRef = datasetsRef(projectId).doc(datasetId);
  const snap = await datasetRef.get();
  if (snap.exists) {
    const d = snap.data() as FirestoreDataset;
    await datasetRef.update({
      totalImages: (d.totalImages ?? 0) + files.length,
      totalSizeBytes: (d.totalSizeBytes ?? 0) + addedSize,
      updatedAt: now,
    });
  }
  await touchProject(projectId);
}

export async function deleteDataset(projectId: string, datasetId: string) {
  const storage = getAdminStorage().bucket(bucketName());

  const imgSnap = await imagesRef(projectId)
    .where("datasetId", "==", datasetId)
    .get();

  const batch = getAdminDb().batch();
  for (const doc of imgSnap.docs) {
    const path = doc.data().storagePath as string;
    try {
      await storage.file(path).delete();
    } catch {
      /* ignore */
    }
    batch.delete(doc.ref);
  }
  await batch.commit();

  try {
    await storage.deleteFiles({
      prefix: `projects/${projectId}/datasets/${datasetId}/`,
    });
  } catch {
    /* ignore */
  }

  await datasetsRef(projectId).doc(datasetId).delete();
  await touchProject(projectId);
}

export async function deleteDatasets(projectId: string, datasetIds: string[]) {
  for (const id of datasetIds) {
    await deleteDataset(projectId, id);
  }
}

export async function deleteImages(
  projectId: string,
  datasetId: string,
  imageIds: string[]
) {
  const storage = getAdminStorage().bucket(bucketName());
  const db = getAdminDb();
  let removedSize = 0;

  for (const imageId of imageIds) {
    const ref = imagesRef(projectId).doc(imageId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const data = snap.data() as FirestoreImage;
    if (data.datasetId !== datasetId) continue;

    try {
      await storage.file(data.storagePath).delete();
    } catch {
      /* ignore */
    }
    removedSize += data.fileSize ?? 0;
    await ref.delete();

    // Remove related annotations
    const annSnap = await db
      .collection(projectSub(projectId, "annotations"))
      .where("imageId", "==", imageId)
      .get();
    const objSnap = await db
      .collection(projectSub(projectId, "annotationObjects"))
      .where("imageId", "==", imageId)
      .get();
    const batch = db.batch();
    annSnap.docs.forEach((d) => batch.delete(d.ref));
    objSnap.docs.forEach((d) => batch.delete(d.ref));
    if (annSnap.docs.length || objSnap.docs.length) await batch.commit();
  }

  const datasetRef = datasetsRef(projectId).doc(datasetId);
  const ds = await datasetRef.get();
  if (ds.exists) {
    const d = ds.data() as FirestoreDataset;
    await datasetRef.update({
      totalImages: Math.max(0, (d.totalImages ?? 0) - imageIds.length),
      totalSizeBytes: Math.max(0, (d.totalSizeBytes ?? 0) - removedSize),
      updatedAt: nowIso(),
    });
  }
  await touchProject(projectId);
}

export async function listImagesByDataset(
  projectId: string,
  datasetId: string
): Promise<FirestoreImage[]> {
  const snap = await imagesRef(projectId)
    .where("datasetId", "==", datasetId)
    .get();
  return snap.docs
    .map((d) => ({
      id: d.id,
      ...(d.data() as Omit<FirestoreImage, "id">),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getImageCount(projectId: string): Promise<number> {
  const snap = await imagesRef(projectId).count().get();
  return snap.data().count;
}

async function touchProject(projectId: string) {
  await getAdminDb()
    .collection("projects")
    .doc(projectId)
    .update({ updatedAt: nowIso() });
}

export function prepareDatasetFilePath(
  projectId: string,
  datasetId: string,
  fileName: string
) {
  const safe = fileName.replace(/[^\w.\-()+ ]/g, "_") || "file";
  return `projects/${projectId}/datasets/${datasetId}/images/${crypto.randomUUID()}-${safe}`;
}
