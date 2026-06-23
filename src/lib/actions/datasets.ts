"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createDataset(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) return { error: "Dataset name is required" };

  const { data, error } = await supabase
    .from("datasets")
    .insert({
      project_id: projectId,
      name,
      description,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/datasets`);
  redirect(`/projects/${projectId}/datasets/${data.id}/upload`);
}

export async function deleteDataset(projectId: string, datasetId: string) {
  const supabase = await createClient();

  const { data: files } = await supabase
    .from("dataset_files")
    .select("file_path")
    .eq("dataset_id", datasetId);

  if (files?.length) {
    await supabase.storage
      .from("datasets")
      .remove(files.map((f) => f.file_path));
  }

  const { error } = await supabase
    .from("datasets")
    .delete()
    .eq("id", datasetId)
    .eq("project_id", projectId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/datasets`);
  return { success: true };
}

export async function registerDatasetFiles(
  projectId: string,
  datasetId: string,
  files: {
    fileName: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
    classId?: string | null;
  }[]
) {
  const supabase = await createClient();

  const rows = files.map((f) => ({
    dataset_id: datasetId,
    project_id: projectId,
    class_id: f.classId ?? null,
    file_name: f.fileName,
    file_path: f.filePath,
    file_size: f.fileSize,
    mime_type: f.mimeType,
  }));

  const { error: insertError } = await supabase
    .from("dataset_files")
    .insert(rows);

  if (insertError) return { error: insertError.message };

  const addedSize = files.reduce((sum, f) => sum + f.fileSize, 0);

  const { data: dataset } = await supabase
    .from("datasets")
    .select("file_count, total_size_bytes")
    .eq("id", datasetId)
    .single();

  if (dataset) {
    await supabase
      .from("datasets")
      .update({
        file_count: dataset.file_count + files.length,
        total_size_bytes: dataset.total_size_bytes + addedSize,
      })
      .eq("id", datasetId);
  }

  revalidatePath(`/projects/${projectId}/datasets`);
  return { success: true };
}
