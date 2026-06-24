"use server";

import { createAdminClient } from "@/lib/supabase/admin";

function buildStoragePath(...segments: string[]) {
  return segments.join("/");
}

export async function prepareModelUpload(projectId: string, fileName: string) {
  const safeName = fileName.replace(/[^\w.\-()+ ]/g, "_") || "model.bin";
  const filePath = buildStoragePath(
    projectId,
    `${crypto.randomUUID()}-${safeName}`
  );
  return { filePath };
}

export async function prepareDatasetFileUpload(
  projectId: string,
  datasetId: string,
  fileName: string
) {
  const safeName = fileName.replace(/[^\w.\-()+ ]/g, "_") || "file";
  const filePath = buildStoragePath(
    projectId,
    datasetId,
    `${crypto.randomUUID()}-${safeName}`
  );
  return { filePath };
}

export async function uploadDatasetFile(
  projectId: string,
  datasetId: string,
  formData: FormData
) {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "No file provided" };

  const filePath = `${projectId}/${datasetId}/${crypto.randomUUID()}-${file.name}`;
  const supabase = createAdminClient();

  const { error } = await supabase.storage
    .from("datasets")
    .upload(filePath, file, { upsert: false });

  if (error) return { error: error.message };

  return {
    success: true,
    file: {
      fileName: file.name,
      filePath,
      fileSize: file.size,
      mimeType: file.type,
    },
  };
}

export async function uploadModelFile(projectId: string, formData: FormData) {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "No file provided" };

  const filePath = `${projectId}/${crypto.randomUUID()}-${file.name}`;
  const supabase = createAdminClient();

  const { error } = await supabase.storage
    .from("models")
    .upload(filePath, file, { upsert: false });

  if (error) return { error: error.message };

  return {
    success: true,
    filePath,
    fileSize: file.size,
  };
}
