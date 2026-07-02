"use server";

import * as datasetService from "@/lib/services/datasetService";
import {
  revalidateDataset,
  revalidateProject,
} from "@/lib/actions/revalidate";
import { redirect } from "next/navigation";

import type { ActionResult } from "@/lib/actions/types";

export async function createDataset(
  projectId: string,
  formData: FormData
): Promise<ActionResult | void> {
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) return { error: "Dataset name is required" };

  let newId: string;
  try {
    newId = await datasetService.createDataset(projectId, { name, description });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create dataset" };
  }

  await revalidateProject(projectId);
  redirect(`/projects/${projectId}/datasets/${newId}/upload`);
}

export async function deleteDataset(
  projectId: string,
  datasetId: string
): Promise<ActionResult> {
  try {
    await datasetService.deleteDataset(projectId, datasetId);
    await revalidateProject(projectId);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete dataset" };
  }
}

export async function deleteDatasets(
  projectId: string,
  datasetIds: string[]
): Promise<ActionResult> {
  try {
    if (datasetIds.length === 0) return { error: "No datasets selected" };
    await datasetService.deleteDatasets(projectId, datasetIds);
    await revalidateProject(projectId);
    return { success: true, count: datasetIds.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete datasets" };
  }
}

export async function deleteAllDatasets(projectId: string): Promise<ActionResult> {
  try {
    const datasets = await datasetService.listDatasets(projectId);
    if (!datasets.length) return { success: true, count: 0 };
    return deleteDatasets(
      projectId,
      datasets.map((d) => d.id)
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete datasets" };
  }
}

export async function deleteDatasetFiles(
  projectId: string,
  datasetId: string,
  fileIds: string[]
): Promise<ActionResult> {
  try {
    if (fileIds.length === 0) return { error: "No files selected" };
    await datasetService.deleteImages(projectId, datasetId, fileIds);
    await revalidateDataset(projectId, datasetId);
    return { success: true, count: fileIds.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete files" };
  }
}

export async function deleteAllDatasetFiles(
  projectId: string,
  datasetId: string,
  fileIds: string[]
): Promise<ActionResult> {
  return deleteDatasetFiles(projectId, datasetId, fileIds);
}
