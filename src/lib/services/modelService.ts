import {
  bucketName,
  getAdminDb,
  getAdminStorage,
  nowIso,
} from "@/lib/firebase/admin";
import { toModel } from "@/lib/firebase/adapters";
import { projectSub } from "@/lib/firebase/paths";
import type { FirestoreModel } from "@/lib/types/firestore";
import type { Model, ModelFormat } from "@/lib/types/database";

function modelsRef(projectId: string) {
  return getAdminDb().collection(projectSub(projectId, "models"));
}

export async function listModels(projectId: string): Promise<Model[]> {
  const snap = await modelsRef(projectId).orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) =>
    toModel(projectId, {
      id: doc.id,
      ...(doc.data() as Omit<FirestoreModel, "id">),
    })
  );
}

export async function getModelCount(projectId: string): Promise<number> {
  const snap = await modelsRef(projectId).count().get();
  return snap.data().count;
}

export async function registerModel(
  projectId: string,
  data: {
    name: string;
    description?: string | null;
    storagePath: string;
    downloadUrl: string;
    fileSize: number;
    format: ModelFormat;
    version: string;
  }
) {
  const now = nowIso();
  const ref = modelsRef(projectId).doc();
  const doc: Omit<FirestoreModel, "id"> = {
    modelName: data.name,
    modelVersion: data.version,
    modelType: data.format,
    storagePath: data.storagePath,
    downloadUrl: data.downloadUrl,
    fileSize: data.fileSize,
    description: data.description ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  await touchProject(projectId);
  return ref.id;
}

export async function deleteModel(projectId: string, modelId: string) {
  const ref = modelsRef(projectId).doc(modelId);
  const snap = await ref.get();
  if (snap.exists) {
    const path = (snap.data() as FirestoreModel).storagePath;
    try {
      await getAdminStorage().bucket(bucketName()).file(path).delete();
    } catch {
      /* ignore */
    }
  }
  await ref.delete();
  await touchProject(projectId);
}

export async function deleteModels(projectId: string, modelIds: string[]) {
  for (const id of modelIds) {
    await deleteModel(projectId, id);
  }
}

export function prepareModelPath(projectId: string, fileName: string) {
  const safe = fileName.replace(/[^\w.\-()+ ]/g, "_") || "model.pt";
  return `projects/${projectId}/models/${crypto.randomUUID()}-${safe}`;
}

async function touchProject(projectId: string) {
  await getAdminDb()
    .collection("projects")
    .doc(projectId)
    .update({ updatedAt: nowIso() });
}
