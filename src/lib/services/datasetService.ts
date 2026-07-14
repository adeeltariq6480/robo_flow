import { cache } from "react";
import { api } from "@/lib/api/client";
import { toDataset } from "@/lib/firebase/adapters";
import type { FirestoreDataset, FirestoreImage } from "@/lib/types/firestore";
import type { Dataset } from "@/lib/types/database";

/** Hidden scratch dataset for Stock check uploads (not shown in Datasets UI). */
export const STOCK_CHECK_DATASET_NAME = "__stock_check__";

export function isStockCheckDataset(name: string): boolean {
  return name === STOCK_CHECK_DATASET_NAME;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

async function fetchAllDatasets(projectId: string): Promise<Dataset[]> {
  const rows = await api.get<FirestoreDataset[]>(`/api/datasets/${projectId}`);
  return asArray<FirestoreDataset>(rows).map((r) => toDataset(projectId, r));
}

/** All datasets including the hidden Stock check scratch bucket. */
export async function listAllDatasets(projectId: string): Promise<Dataset[]> {
  return fetchAllDatasets(projectId);
}

/** Visible datasets only — excludes the Stock check scratch bucket. */
export const listDatasets = cache(async (projectId: string): Promise<Dataset[]> => {
  const all = await fetchAllDatasets(projectId);
  return all.filter((d) => !isStockCheckDataset(d.name));
});

export const listDatasetsBrief = cache(async (projectId: string) => {
  const all = await fetchAllDatasets(projectId);
  return all
    .filter((d) => !isStockCheckDataset(d.name))
    .map((d) => ({ id: d.id, name: d.name }));
});

/** Create or return the project Stock check scratch dataset. */
export async function ensureStockCheckDataset(
  projectId: string
): Promise<Dataset> {
  const all = await fetchAllDatasets(projectId);
  const existing = all.find((d) => isStockCheckDataset(d.name));
  if (existing) return existing;
  const id = await createDataset(projectId, {
    name: STOCK_CHECK_DATASET_NAME,
    description: "Temporary Stock check images (not a training dataset)",
  });
  const created = await getDataset(projectId, id);
  if (!created) {
    throw new Error("Failed to create Stock check dataset");
  }
  return created;
}

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
  return asArray<FirestoreImage>(rows).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
});
export async function getImageCount(projectId: string): Promise<number> {
  const stats = await api.get<{ imageCount: number }>(
    `/api/projects/${projectId}/stats`
  );
  return stats.imageCount;
}
