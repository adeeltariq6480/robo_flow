"use server";

import { createColabLaunch } from "@/lib/worker/client";

export type ColabLaunchResult =
  | {
      ok: true;
      colabUrl: string;
      prefillUrl?: string;
      jobId?: string;
      message?: string;
    }
  | { ok: false; error: string };

export async function openColabLaunch(params: {
  projectId: string;
  datasetId: string;
  modelIds: string[];
  confidence?: number;
  iou?: number;
  relabelAll?: boolean;
}): Promise<ColabLaunchResult> {
  if (params.modelIds.length === 0) {
    return { ok: false, error: "Select at least one model" };
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
      ok: true,
      colabUrl: result.colab_url,
      prefillUrl: result.prefill_url ?? undefined,
      jobId: result.job_id ?? undefined,
      message: result.message,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not create Colab link",
    };
  }
}
