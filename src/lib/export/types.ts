import type { AnnotationBox } from "@/lib/types/annotations";
import type { Class } from "@/lib/types/database";

export type ExportFormat = "yolo" | "coco" | "voc" | "csv";

export const EXPORT_FORMAT_LABELS: Record<
  ExportFormat,
  { label: string; description: string; extension: string; mime: string }
> = {
  yolo: {
    label: "YOLO TXT",
    description: "labels/*.txt, classes.txt, data.yaml (zip)",
    extension: "zip",
    mime: "application/zip",
  },
  coco: {
    label: "COCO JSON",
    description: "Single annotations.json with categories & bboxes",
    extension: "json",
    mime: "application/json",
  },
  voc: {
    label: "Pascal VOC XML",
    description: "annotations/*.xml per image (zip)",
    extension: "zip",
    mime: "application/zip",
  },
  csv: {
    label: "CSV",
    description: "Flat spreadsheet — one row per bounding box",
    extension: "csv",
    mime: "text/csv",
  },
};

export interface ExportImageFile {
  id: string;
  fileName: string;
  filePath: string;
  width: number;
  height: number;
  annotations: AnnotationBox[];
}

export interface ExportDataset {
  projectId: string;
  projectName: string;
  datasetId: string;
  datasetName: string;
  classes: Class[];
  files: ExportImageFile[];
}

export interface ExportArtifact {
  fileName: string;
  mimeType: string;
  body: Buffer | string;
}

export interface ZipEntry {
  path: string;
  content: string;
}
