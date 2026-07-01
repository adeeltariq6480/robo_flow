import { API_BASE_URL, api } from "@/lib/api/client";
import { getDatasetReviewQueue } from "@/lib/services/annotationService";
import type { ExportFormat } from "@/lib/export/types";
import { EXPORT_FORMAT_LABELS } from "@/lib/export/types";

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

/** Download export ZIP directly (images + label files). Runs in the browser. */
export async function downloadExportZip(
  projectId: string,
  format: ExportFormat
): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(`${API_BASE_URL}/api/export/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, exportFormat: format }),
  });

  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
    } catch {
      const text = await res.text();
      if (text) message = text;
    }
    throw new Error(message);
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^";\n]+)"?/i);
  const fileName =
    match?.[1] ?? `${format}-export.${EXPORT_FORMAT_LABELS[format].extension}`;

  return { blob: await res.blob(), fileName };
}

export async function getApprovedExportStats(
  projectId: string,
  datasetId: string
): Promise<{ approvedCount: number }> {
  const approved = await getDatasetReviewQueue(projectId, datasetId, "approved");
  return { approvedCount: approved.length };
}
