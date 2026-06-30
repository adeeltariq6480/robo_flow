import { api } from "@/lib/api/client";
import { getDatasetReviewQueue } from "@/lib/services/annotationService";
import type { ExportFormat } from "@/lib/export/types";

export interface ExportResult {
  exportJobId: string;
  hfRepo: string;
  hfPath: string;
  fileName: string;
}

/**
 * Trigger a backend export. FastAPI builds the artifact (YOLO TXT, COCO JSON,
 * Pascal VOC XML, or CSV) from approved annotations and uploads it to Hugging Face.
 */
export async function exportToHuggingFace(
  projectId: string,
  format: ExportFormat
): Promise<ExportResult> {
  return api.post<ExportResult>("/api/export", {
    projectId,
    exportFormat: format,
  });
}

export async function getApprovedExportStats(
  projectId: string,
  datasetId: string
): Promise<{ approvedCount: number }> {
  const approved = await getDatasetReviewQueue(projectId, datasetId, "approved");
  return { approvedCount: approved.length };
}
