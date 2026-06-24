"use server";

import * as modelService from "@/lib/services/modelService";
import { revalidatePath } from "next/cache";
import type { ModelFormat } from "@/lib/types/database";

import type { ActionResult } from "@/lib/actions/types";

export async function registerModel(
  projectId: string,
  data: {
    name: string;
    description?: string | null;
    filePath: string;
    fileSize: number;
    format: ModelFormat;
    version: string;
    downloadUrl?: string;
  }
): Promise<ActionResult> {
  try {
    await modelService.registerModel(projectId, {
      name: data.name,
      description: data.description,
      storagePath: data.filePath,
      downloadUrl: data.downloadUrl ?? "",
      fileSize: data.fileSize,
      format: data.format,
      version: data.version,
    });

    revalidatePath(`/projects/${projectId}/models`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to register model" };
  }
}

export async function deleteModel(
  projectId: string,
  modelId: string
): Promise<ActionResult> {
  try {
    await modelService.deleteModel(projectId, modelId);
    revalidatePath(`/projects/${projectId}/models`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete model" };
  }
}

export async function deleteModels(
  projectId: string,
  modelIds: string[]
): Promise<ActionResult> {
  try {
    if (modelIds.length === 0) return { error: "No models selected" };
    await modelService.deleteModels(projectId, modelIds);
    revalidatePath(`/projects/${projectId}/models`);
    return { success: true, count: modelIds.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete models" };
  }
}

export async function deleteAllModels(projectId: string): Promise<ActionResult> {
  try {
    const models = await modelService.listModels(projectId);
    if (!models.length) return { success: true, count: 0 };
    return deleteModels(
      projectId,
      models.map((m) => m.id)
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete models" };
  }
}
