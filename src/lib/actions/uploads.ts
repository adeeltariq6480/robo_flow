"use server";

import { createAdminClient } from "@/lib/supabase/admin";

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
