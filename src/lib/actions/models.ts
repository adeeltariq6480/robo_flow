"use server";

import * as modelService from "@/lib/services/modelService";
import { revalidateProject } from "@/lib/actions/revalidate";

import type { ActionResult } from "@/lib/actions/types";

export async function deleteModel(
  projectId: string,
  modelId: string
): Promise<ActionResult> {
  try {
    await modelService.deleteModel(projectId, modelId);
    await revalidateProject(projectId);
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
    await revalidateProject(projectId);
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
