import { cache } from "react";
import { api } from "@/lib/api/client";
import { toDataset } from "@/lib/firebase/adapters";
import type { FirestoreDataset, FirestoreImage } from "@/lib/types/firestore";
import type { Dataset } from "@/lib/types/database";

export const listDatasets = cache(async (projectId: string): Promise<Dataset[]> => {
  const rows = await api.get<FirestoreDataset[]>(`/api/datasets/${projectId}`);
  return rows.map((r) => toDataset(projectId, r));
});

export const listDatasetsBrief = cache(async (projectId: string) => {
  const rows = await api.get<FirestoreDataset[]>(`/api/datasets/${projectId}`);
  return rows.map((d) => ({ id: d.id, name: d.name }));
});

export const getDataset = cache(async (
  projectId: string,
  datasetId: string
): Promise<Dataset | null> => {
  try {
    const row = await api.get<FirestoreDataset>(
      `/api/datasets/${projectId}/${datasetId}`
    );
    return toDataset(projectId, row);
  } catch {
    return null;
  }
});
export async function createDataset(
  projectId: string,
  data: { name: string; description?: string | null }
): Promise<string> {
  const row = await api.post<FirestoreDataset>("/api/datasets", {
    projectId,
    name: data.name,
  });
  return row.id;
}

export async function deleteDataset(projectId: string, datasetId: string) {
  await api.del(`/api/datasets/${projectId}/${datasetId}`);
}

export async function deleteDatasets(projectId: string, datasetIds: string[]) {
  await Promise.all(datasetIds.map((id) => deleteDataset(projectId, id)));
}

export async function deleteImages(
  projectId: string,
  datasetId: string,
  imageIds: string[]
) {
  await api.post(`/api/datasets/${projectId}/${datasetId}/delete-images`, {
    imageIds,
  });
}

export const listImagesByDataset = cache(async (
  projectId: string,
  datasetId: string
): Promise<FirestoreImage[]> => {
  const rows = await api.get<FirestoreImage[]>(
    `/api/datasets/${projectId}/${datasetId}/images`
  );
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
});
export async function getImageCount(projectId: string): Promise<number> {
  const stats = await api.get<{ imageCount: number }>(
    `/api/projects/${projectId}/stats`
  );
  return stats.imageCount;
}
