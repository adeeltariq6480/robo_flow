"use server";

import * as datasetService from "@/lib/services/datasetService";
import * as modelService from "@/lib/services/modelService";

export async function prepareModelUpload(projectId: string, fileName: string) {
  const filePath = modelService.prepareModelPath(projectId, fileName);
  return { filePath };
}

export async function prepareDatasetFileUpload(
  projectId: string,
  datasetId: string,
  fileName: string
) {
  const filePath = datasetService.prepareDatasetFilePath(
    projectId,
    datasetId,
    fileName
  );
  return { filePath };
}
