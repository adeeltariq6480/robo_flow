"use server";

import { getDatasetInventory, type DatasetInventory } from "@/lib/worker/client";

export async function fetchDatasetInventory(
  projectId: string,
  datasetId: string
): Promise<DatasetInventory | { error: string }> {
  try {
    return await getDatasetInventory(projectId, datasetId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}
