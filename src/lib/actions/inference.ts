"use server";

import {
  submitTestRun,
  submitAutoLabel,
  submitModelCompare,
  getJob,
  cancelJob,
  resumeJob,
  type JobConfig,
} from "@/lib/worker/client";
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
