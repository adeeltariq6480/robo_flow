import { createAdminClient } from "@/lib/supabase/admin";
import { parseAnnotations } from "@/lib/annotations/coords";
import { fetchImageDimensions } from "@/lib/export/image-dimensions";
import type { ExportDataset, ExportFormat } from "@/lib/export/types";
import type { Class } from "@/lib/types/database";
import JSZip from "jszip";
import { buildCocoExport } from "@/lib/export/coco";
import { buildCsvExport } from "@/lib/export/csv";
import { buildVocExport } from "@/lib/export/voc";
import { buildYoloExport } from "@/lib/export/yolo";
import { EXPORT_FORMAT_LABELS } from "@/lib/export/types";

const IMAGE_MIME_PREFIX = "image/";
const DEFAULT_DIMENSION = 640;

export async function loadApprovedExportData(
  projectId: string,
  datasetId: string
): Promise<{ data?: ExportDataset; error?: string; approvedCount?: number }> {
  const supabase = createAdminClient();

  const [{ data: project }, { data: dataset }, { data: classes }, { data: files }] =
    await Promise.all([
      supabase.from("projects").select("name").eq("id", projectId).single(),
      supabase
        .from("datasets")
        .select("name")
        .eq("id", datasetId)
        .eq("project_id", projectId)
        .single(),
      supabase
        .from("classes")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("dataset_files")
        .select(
          "id, file_name, file_path, mime_type, annotations, review_status"
        )
        .eq("project_id", projectId)
        .eq("dataset_id", datasetId)
        .eq("review_status", "approved")
        .like("mime_type", `${IMAGE_MIME_PREFIX}%`)
        .order("created_at", { ascending: true }),
    ]);

  if (!project || !dataset) {
    return { error: "Project or dataset not found" };
  }

  const approvedFiles = files ?? [];
  if (approvedFiles.length === 0) {
    return {
      error: "No approved images found. Approve labels in the review editor first.",
      approvedCount: 0,
    };
  }

  const exportFiles = await Promise.all(
    approvedFiles.map(async (row) => {
      const { data: signed } = await supabase.storage
        .from("datasets")
        .createSignedUrl(row.file_path, 300);

      let width = DEFAULT_DIMENSION;
      let height = DEFAULT_DIMENSION;

      if (signed?.signedUrl) {
        const dims = await fetchImageDimensions(signed.signedUrl);
        if (dims) {
          width = dims.width;
          height = dims.height;
        }
      }

      return {
        id: row.id,
        fileName: row.file_name,
        filePath: row.file_path,
        width,
        height,
        annotations: parseAnnotations(row.annotations),
      };
    })
  );

  return {
    approvedCount: exportFiles.length,
    data: {
      projectId,
      projectName: project.name,
      datasetId,
      datasetName: dataset.name,
      classes: (classes ?? []) as Class[],
      files: exportFiles,
    },
  };
}

export async function buildExportArtifact(
  data: ExportDataset,
  format: ExportFormat
): Promise<{ fileName: string; mimeType: string; body: Buffer }> {
  const slug = sanitizeFilename(data.datasetName);
  const meta = EXPORT_FORMAT_LABELS[format];

  if (format === "coco") {
    return {
      fileName: `${slug}-coco.json`,
      mimeType: meta.mime,
      body: Buffer.from(buildCocoExport(data), "utf-8"),
    };
  }

  if (format === "csv") {
    return {
      fileName: `${slug}-labels.csv`,
      mimeType: meta.mime,
      body: Buffer.from(buildCsvExport(data), "utf-8"),
    };
  }

  const zip = new JSZip();
  const entries = format === "yolo" ? buildYoloExport(data) : buildVocExport(data);
  for (const entry of entries) {
    zip.file(entry.path, entry.content);
  }

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  return {
    fileName: `${slug}-${format}.zip`,
    mimeType: meta.mime,
    body: zipBuffer,
  };
}

function sanitizeFilename(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "dataset";
}

export async function getApprovedExportStats(
  projectId: string,
  datasetId: string
) {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("dataset_files")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("dataset_id", datasetId)
    .eq("review_status", "approved")
    .like("mime_type", `${IMAGE_MIME_PREFIX}%`);

  if (error) return { error: error.message };
  return { approvedCount: count ?? 0 };
}
