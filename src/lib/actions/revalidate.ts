"use server";

import { revalidatePath } from "next/cache";

/** Refresh all project-scoped pages after any create/update/delete/upload. */
export async function revalidateProject(projectId: string) {
  const base = `/projects/${projectId}`;
  revalidatePath("/", "layout");
  revalidatePath(base, "layout");
  revalidatePath(`${base}/classes`);
  revalidatePath(`${base}/datasets`);
  revalidatePath(`${base}/models`);
  revalidatePath(`${base}/inference`);
}

/** Refresh dataset sub-routes (review, upload, label, export). */
export async function revalidateDataset(projectId: string, datasetId: string) {
  await revalidateProject(projectId);
  const base = `/projects/${projectId}/datasets/${datasetId}`;
  revalidatePath(`${base}/upload`);
  revalidatePath(`${base}/review`, "layout");
  revalidatePath(`${base}/label`);
  revalidatePath(`${base}/export`);
}

export async function revalidateProjectsList() {
  revalidatePath("/", "layout");
}
