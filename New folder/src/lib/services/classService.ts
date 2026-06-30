import { api } from "@/lib/api/client";
import { toClass } from "@/lib/firebase/adapters";
import type { FirestoreClass } from "@/lib/types/firestore";
import type { Class } from "@/lib/types/database";

/**
 * The backend exposes a single "replace all classes" endpoint (POST /api/classes).
 * Granular create/update/delete are implemented client-side by reading the
 * current list, applying the change, and saving the whole list back.
 */

interface ClassPayload {
  className: string;
  classIndex: number;
  color?: string | null;
  description?: string | null;
}

async function fetchRaw(projectId: string): Promise<FirestoreClass[]> {
  return api.get<FirestoreClass[]>(`/api/classes/${projectId}`);
}

async function saveAll(projectId: string, classes: ClassPayload[]) {
  await api.post("/api/classes", { projectId, classes });
}

function toPayload(c: FirestoreClass): ClassPayload {
  return {
    className: c.className,
    classIndex: c.classIndex,
    color: c.color ?? null,
    description: c.description ?? null,
  };
}

export async function listClasses(projectId: string): Promise<Class[]> {
  const rows = await fetchRaw(projectId);
  return rows
    .sort((a, b) => a.classIndex - b.classIndex)
    .map((r) => toClass(projectId, r));
}

export async function getClassCount(projectId: string): Promise<number> {
  return (await fetchRaw(projectId)).length;
}

export async function createClass(
  projectId: string,
  data: { name: string; description?: string | null; color: string; sortOrder: number }
) {
  const current = (await fetchRaw(projectId)).map(toPayload);
  current.push({
    className: data.name,
    classIndex: data.sortOrder,
    color: data.color,
    description: data.description ?? null,
  });
  await saveAll(projectId, current);
}

export async function createClassesBulk(
  projectId: string,
  rows: { name: string; color: string; sortOrder: number }[]
) {
  const current = (await fetchRaw(projectId)).map(toPayload);
  for (const row of rows) {
    current.push({ className: row.name, classIndex: row.sortOrder, color: row.color });
  }
  await saveAll(projectId, current);
}

export async function updateClass(
  projectId: string,
  classId: string,
  data: { name: string; description?: string | null; color: string }
) {
  const current = await fetchRaw(projectId);
  const updated = current.map((c) =>
    c.id === classId
      ? toPayload({
          ...c,
          className: data.name,
          description: data.description ?? null,
          color: data.color,
        })
      : toPayload(c)
  );
  await saveAll(projectId, updated);
}

export async function deleteClass(projectId: string, classId: string) {
  const current = await fetchRaw(projectId);
  await saveAll(
    projectId,
    current.filter((c) => c.id !== classId).map(toPayload)
  );
}

export async function deleteClasses(projectId: string, classIds: string[]) {
  const remove = new Set(classIds);
  const current = await fetchRaw(projectId);
  await saveAll(
    projectId,
    current.filter((c) => !remove.has(c.id)).map(toPayload)
  );
}

export async function deleteAllClasses(projectId: string) {
  await saveAll(projectId, []);
}
