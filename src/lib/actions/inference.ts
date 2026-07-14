"use server";

import {
  submitTestRun,
  submitAutoLabel,
  submitModelCompare,
  getJob,
  cancelJob,
  resumeJob,
  getDatasetLabelStats,
  getActiveDatasetJob,
  startStockColabSession,
  getStockColabSession,
  type JobConfig,
  type DatasetLabelStats,
} from "@/lib/worker/client";

export async function openStockColabCheck(
  projectId: string,
  modelIds: string[],
  imageUrls: string[]
) {
  try {
    return await startStockColabSession({
      project_id: projectId, model_ids: modelIds, image_urls: imageUrls,
      confidence: 0.15, iou: 0.45,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not open Colab" };
  }
}

export async function fetchStockColabSession(token: string) {
  try {
    return await getStockColabSession(token);
  } catch (e) {
    return { actionError: e instanceof Error ? e.message : "Could not read Colab progress" };
  }
}
import {
  getModelsAvailability,
  type ModelsAvailabilityResponse,
} from "@/lib/services/modelService";

export async function fetchModelsAvailability(
  projectId: string
): Promise<ModelsAvailabilityResponse | { error: string }> {
  try {
    return await getModelsAvailability(projectId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}

export async function startTestRun(
  projectId: string,
  modelId: string,
  datasetFileId: string,
  config?: JobConfig
) {
  try {
    return await submitTestRun({
      project_id: projectId,
      model_id: modelId,
      dataset_file_id: datasetFileId,
      config,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}

export async function fetchDatasetLabelStats(
  projectId: string,
  datasetId: string
): Promise<DatasetLabelStats | { error: string }> {
  try {
    return await getDatasetLabelStats(projectId, datasetId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}

export async function fetchActiveDatasetJob(projectId: string, datasetId: string) {
  try {
    return await getActiveDatasetJob(projectId, datasetId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}

export async function startAutoLabel(
  projectId: string,
  modelIds: string[],
  datasetId: string,
  config?: JobConfig,
  options?: { skipLabeled?: boolean }
) {
  if (modelIds.length === 0) {
    return { error: "Select at least one model" };
  }
  try {
    return await submitAutoLabel({
      project_id: projectId,
      model_id: modelIds[0],
      model_ids: modelIds,
      dataset_id: datasetId,
      skip_labeled: options?.skipLabeled ?? false,
      relabel_all: config?.relabel_all ?? false,
      config,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}

export async function startModelCompare(
  projectId: string,
  modelIds: string[],
  datasetFileId: string,
  config?: JobConfig
) {
  try {
    return await submitModelCompare({
      project_id: projectId,
      model_ids: modelIds,
      dataset_file_id: datasetFileId,
      config,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}

export async function fetchJobStatus(jobId: string, projectId?: string) {
  try {
    return await getJob(jobId, projectId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}

export async function cancelInferenceJob(jobId: string, projectId?: string) {
  try {
    return await cancelJob(jobId, projectId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}

export async function resumeInferenceJob(jobId: string, projectId?: string) {
  try {
    return await resumeJob(jobId, projectId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Worker unavailable" };
  }
}
