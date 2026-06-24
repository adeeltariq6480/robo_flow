import type { AnnotationBox } from "@/lib/types/annotations";
import type { Class } from "@/lib/types/database";

export type ExportFormat = "yolo" | "coco" | "voc" | "csv";

export const EXPORT_FORMAT_LABELS: Record<
  ExportFormat,
  { label: string; description: string; extension: string; mime: string }
> = {
  yolo: {
    label: "YOLO TXT",
    description: "images/, labels/*.txt, classes.txt, data.yaml (zip)",
    extension: "zip",
    mime: "application/zip",
  },
  coco: {
    label: "COCO JSON",
    description: "annotations.json + images/ folder (zip)",
    extension: "zip",
    mime: "application/zip",
  },
  voc: {
    label: "Pascal VOC XML",
    description: "images/, annotations/*.xml (zip)",
    extension: "zip",
    mime: "application/zip",
  },
  csv: {
    label: "CSV",
    description: "labels.csv + images/ folder (zip)",
    extension: "zip",
    mime: "application/zip",
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
  content: string | Buffer | Uint8Array;
}
