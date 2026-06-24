import { getAdminDb, nowIso } from "@/lib/firebase/admin";
import { toClass } from "@/lib/firebase/adapters";
import { projectSub } from "@/lib/firebase/paths";
import type { FirestoreClass } from "@/lib/types/firestore";
import type { Class } from "@/lib/types/database";

function classesRef(projectId: string) {
  return getAdminDb().collection(projectSub(projectId, "classes"));
}

export async function listClasses(projectId: string): Promise<Class[]> {
  const snap = await classesRef(projectId).orderBy("classIndex", "asc").get();
  return snap.docs.map((doc) =>
    toClass(projectId, {
      id: doc.id,
      ...(doc.data() as Omit<FirestoreClass, "id">),
    })
  );
}

export async function getClassCount(projectId: string): Promise<number> {
  const snap = await classesRef(projectId).count().get();
  return snap.data().count;
}

export async function createClass(
  projectId: string,
  data: { name: string; description?: string | null; color: string; sortOrder: number }
) {
  const now = nowIso();
  const ref = classesRef(projectId).doc();
  const doc: Omit<FirestoreClass, "id"> = {
    className: data.name,
    classIndex: data.sortOrder,
    color: data.color,
    description: data.description ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  await touchProject(projectId);
  return ref.id;
}

export async function createClassesBulk(
  projectId: string,
  rows: { name: string; color: string; sortOrder: number }[]
) {
  const db = getAdminDb();
  const batch = db.batch();
  const now = nowIso();

  for (const row of rows) {
    const ref = classesRef(projectId).doc();
    batch.set(ref, {
      className: row.name,
      classIndex: row.sortOrder,
      color: row.color,
      description: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();
  await touchProject(projectId);
}

export async function updateClass(
  projectId: string,
  classId: string,
  data: { name: string; description?: string | null; color: string }
) {
  await classesRef(projectId)
    .doc(classId)
    .update({
      className: data.name,
      description: data.description ?? null,
      color: data.color,
      updatedAt: nowIso(),
    });
  await touchProject(projectId);
}

export async function deleteClass(projectId: string, classId: string) {
  await classesRef(projectId).doc(classId).delete();
  await touchProject(projectId);
}

export async function deleteClasses(projectId: string, classIds: string[]) {
  const batch = getAdminDb().batch();
  for (const id of classIds) {
    batch.delete(classesRef(projectId).doc(id));
  }
  await batch.commit();
  await touchProject(projectId);
}

export async function deleteAllClasses(projectId: string) {
  const snap = await classesRef(projectId).get();
  const batch = getAdminDb().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (snap.docs.length) await batch.commit();
  await touchProject(projectId);
}

async function touchProject(projectId: string) {
  await getAdminDb()
    .collection("projects")
    .doc(projectId)
    .update({ updatedAt: nowIso() });
}
