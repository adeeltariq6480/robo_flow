import { getApprovedExportFiles } from "@/lib/services/annotationService";
import { listClasses } from "@/lib/services/classService";
import { getDataset } from "@/lib/services/datasetService";
import { getProjectById } from "@/lib/services/projectService";
import { getSignedImageUrl } from "@/lib/services/annotationService";
import { fetchImageDimensions } from "@/lib/export/image-dimensions";
import type { ExportDataset, ExportFormat } from "@/lib/export/types";
import { buildCocoExport } from "@/lib/export/coco";
import { buildCsvExport } from "@/lib/export/csv";
import { buildVocExport } from "@/lib/export/voc";
import { buildYoloExport } from "@/lib/export/yolo";
import { EXPORT_FORMAT_LABELS } from "@/lib/export/types";
import JSZip from "jszip";

const DEFAULT_DIMENSION = 640;

export async function loadApprovedExportData(
  projectId: string,
  datasetId: string
): Promise<{ data?: ExportDataset; error?: string; approvedCount?: number }> {
  const [project, dataset, classes, approvedFiles] = await Promise.all([
    getProjectById(projectId),
    getDataset(projectId, datasetId),
    listClasses(projectId),
    getApprovedExportFiles(projectId, datasetId),
  ]);

  if (!project || !dataset) {
    return { error: "Project or dataset not found" };
  }

  if (approvedFiles.length === 0) {
    return {
      error: "No approved images found. Approve labels in the review editor first.",
      approvedCount: 0,
    };
  }

  const exportFiles = await Promise.all(
    approvedFiles.map(async (row) => {
      const url =
        row.downloadUrl || (await getSignedImageUrl(row.storagePath));

      let width = DEFAULT_DIMENSION;
      let height = DEFAULT_DIMENSION;
      const dims = await fetchImageDimensions(url);
      if (dims) {
        width = dims.width;
        height = dims.height;
      }

      return {
        id: row.id,
        fileName: row.fileName,
        filePath: row.storagePath,
        imageUrl: url,
        width,
        height,
        annotations: row.annotations,
      };
    })
  );

  return {
    data: {
      projectId,
      datasetId,
      projectName: project.name,
      datasetName: dataset.name,
      classes,
      files: exportFiles,
    },
    approvedCount: approvedFiles.length,
  };
}

export async function buildExportArtifact(
  data: ExportDataset,
  format: ExportFormat
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const zip = new JSZip();
  const label = EXPORT_FORMAT_LABELS[format];

  switch (format) {
    case "yolo": {
      for (const entry of buildYoloExport(data)) {
        zip.file(entry.path, entry.content);
      }
      break;
    }
    case "coco": {
      zip.file("annotations.json", buildCocoExport(data));
      break;
    }
    case "voc": {
      for (const entry of buildVocExport(data)) {
        zip.file(entry.path, entry.content);
      }
      break;
    }
    case "csv": {
      zip.file("labels.csv", buildCsvExport(data));
      break;
    }
  }

  const imagesFolder = zip.folder("images");
  if (imagesFolder) {
    for (const file of data.files) {
      const url = file.imageUrl;
      if (!url) continue;
      const res = await fetch(url);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        imagesFolder.file(file.fileName, buf);
      }
    }
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const safeName = data.datasetName.replace(/[^\w.\-]+/g, "_");
  return {
    buffer: Buffer.from(buffer),
    fileName: `${safeName}-${label}.zip`,
    mimeType: "application/zip",
  };
}

export async function getApprovedExportStats(
  projectId: string,
  datasetId: string
) {
  const loaded = await loadApprovedExportData(projectId, datasetId);
  return { approvedCount: loaded.approvedCount ?? 0 };
}
