import {
  bucketName,
  getAdminDb,
  getAdminStorage,
  nowIso,
} from "@/lib/firebase/admin";
import { toProject } from "@/lib/firebase/adapters";
import { COLLECTIONS } from "@/lib/firebase/paths";
import type { FirestoreProject } from "@/lib/types/firestore";
import type { Project } from "@/lib/types/database";

export async function listProjects(): Promise<Project[]> {
  const snap = await getAdminDb()
    .collection(COLLECTIONS.projects)
    .orderBy("updatedAt", "desc")
    .get();

  return snap.docs.map((doc) =>
    toProject({ id: doc.id, ...(doc.data() as Omit<FirestoreProject, "id">) })
  );
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  const snap = await getAdminDb()
    .collection(COLLECTIONS.projects)
    .doc(projectId)
    .get();
  if (!snap.exists) return null;
  return toProject({
    id: snap.id,
    ...(snap.data() as Omit<FirestoreProject, "id">),
  });
}

export async function createProject(data: {
  name: string;
  description?: string | null;
  createdBy?: string | null;
}): Promise<string> {
  const db = getAdminDb();
  const now = nowIso();
  const ref = db.collection(COLLECTIONS.projects).doc();
  const doc: Omit<FirestoreProject, "id"> = {
    name: data.name,
    description: data.description ?? null,
    annotationType: "bounding_box",
    createdBy: data.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return ref.id;
}

export async function deleteProject(projectId: string) {
  const db = getAdminDb();
  const storage = getAdminStorage().bucket(bucketName());
  const projectRef = db.collection(COLLECTIONS.projects).doc(projectId);

  // Delete subcollections (batch delete in chunks)
  const subcollections = [
    "classes",
    "datasets",
    "images",
    "models",
    "annotations",
    "annotationObjects",
    "labellingJobs",
    "reviewQueues",
    "exportJobs",
    "auditLogs",
    "modelTestRuns",
    "modelComparisonResults",
  ];

  for (const sub of subcollections) {
    const snap = await projectRef.collection(sub).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (snap.docs.length) await batch.commit();
  }

  try {
    await storage.deleteFiles({ prefix: `projects/${projectId}/` });
  } catch {
    /* storage may be empty */
  }

  await projectRef.delete();
}

export async function deleteProjects(projectIds: string[]) {
  for (const id of projectIds) {
    await deleteProject(id);
  }
}

export async function getProjectStats(projectId: string) {
  const db = getAdminDb();
  const projectRef = db.collection(COLLECTIONS.projects).doc(projectId);

  const [classes, datasets, models, images] = await Promise.all([
    projectRef.collection("classes").count().get(),
    projectRef.collection("datasets").count().get(),
    projectRef.collection("models").count().get(),
    projectRef.collection("images").count().get(),
  ]);

  return {
    classCount: classes.data().count,
    datasetCount: datasets.data().count,
    modelCount: models.data().count,
    imageCount: images.data().count,
  };
}
