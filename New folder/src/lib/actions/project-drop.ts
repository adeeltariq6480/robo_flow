"use server";

import { listDatasetsBrief } from "@/lib/services/datasetService";

export async function listProjectDatasetsBrief(projectId: string) {
  const datasets = await listDatasetsBrief(projectId);
  return { datasets };
}
