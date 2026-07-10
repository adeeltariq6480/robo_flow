"use server";

import { createColabLaunch } from "@/lib/worker/client";

export async function openColabLaunch(params: {
  projectId: string;
  datasetId: string;
  modelIds: string[];
  confidence?: number;
  iou?: number;
  relabelAll?: boolean;
}): Promise<{ colabUrl: string; jobId?: string; message?: string } | { error: string }> {
  if (params.modelIds.length === 0) {
    return { error: "Select at least one model" };
  }
  try {
    const result = await createColabLaunch({
      project_id: params.projectId,
      dataset_id: params.datasetId,
      model_ids: params.modelIds,
      confidence: params.confidence ?? 0.15,
      iou: params.iou ?? 0.45,
      relabel_all: params.relabelAll ?? false,
    });
    return {
      colabUrl: result.colab_url,
      jobId: result.job_id ?? undefined,
      message: result.message,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create Colab link" };
  }
}
