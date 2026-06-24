"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createDataset(projectId: string, formData: FormData) {
  const supabase = createAdminClient();
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) return { error: "Dataset name is required" };

  const { data, error } = await supabase
    .from("datasets")
    .insert({
      project_id: projectId,
      name,
      description,
      created_by: null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/datasets`);
  redirect(`/projects/${projectId}/datasets/${data.id}/upload`);
}

export async function deleteDataset(projectId: string, datasetId: string) {
  const supabase = createAdminClient();

  const { data: files } = await supabase
    .from("dataset_files")
    .select("file_path")
    .eq("dataset_id", datasetId);

  if (files?.length) {
    await supabase.storage.from("datasets").remove(files.map((f) => f.file_path));
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

export async function deleteDatasets(projectId: string, datasetIds: string[]) {
  if (datasetIds.length === 0) return { error: "No datasets selected" };

  const supabase = createAdminClient();

  for (const datasetId of datasetIds) {
    const { data: files } = await supabase
      .from("dataset_files")
      .select("file_path")
      .eq("dataset_id", datasetId);

    if (files?.length) {
      await supabase.storage.from("datasets").remove(files.map((f) => f.file_path));
    }

    const { error } = await supabase
      .from("datasets")
      .delete()
      .eq("id", datasetId)
      .eq("project_id", projectId);

    if (error) return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/datasets`);
  return { success: true, count: datasetIds.length };
}

export async function deleteAllDatasets(projectId: string) {
  const supabase = createAdminClient();

  const { data: datasets } = await supabase
    .from("datasets")
    .select("id")
    .eq("project_id", projectId);

  if (!datasets?.length) return { success: true, count: 0 };

  return deleteDatasets(
    projectId,
    datasets.map((d) => d.id)
  );
}

export async function deleteDatasetFiles(
  projectId: string,
  datasetId: string,
  fileIds: string[]
) {
  if (fileIds.length === 0) return { error: "No files selected" };

  const supabase = createAdminClient();

  const { data: files } = await supabase
    .from("dataset_files")
    .select("id, file_path, file_size")
    .eq("project_id", projectId)
    .eq("dataset_id", datasetId)
    .in("id", fileIds);

  if (!files?.length) return { error: "Files not found" };

  await supabase.storage.from("datasets").remove(files.map((f) => f.file_path));

  const removedSize = files.reduce((sum, f) => sum + (f.file_size ?? 0), 0);

  const { error } = await supabase
    .from("dataset_files")
    .delete()
    .in("id", fileIds)
    .eq("project_id", projectId)
    .eq("dataset_id", datasetId);

  if (error) return { error: error.message };

  const { data: dataset } = await supabase
    .from("datasets")
    .select("file_count, total_size_bytes")
    .eq("id", datasetId)
    .single();

  if (dataset) {
    await supabase
      .from("datasets")
      .update({
        file_count: Math.max(0, dataset.file_count - files.length),
        total_size_bytes: Math.max(0, dataset.total_size_bytes - removedSize),
      })
      .eq("id", datasetId);
  }

  revalidatePath(`/projects/${projectId}/datasets`);
  revalidatePath(`/projects/${projectId}/datasets/${datasetId}/review`);
  return { success: true, count: files.length };
}

export async function deleteAllDatasetFiles(
  projectId: string,
  datasetId: string,
  fileIds: string[]
) {
  return deleteDatasetFiles(projectId, datasetId, fileIds);
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
  const supabase = createAdminClient();

  const rows = files.map((f) => ({
    dataset_id: datasetId,
    project_id: projectId,
    class_id: f.classId ?? null,
    file_name: f.fileName,
    file_path: f.filePath,
    file_size: f.fileSize,
    mime_type: f.mimeType,
  }));

  const { error: insertError } = await supabase.from("dataset_files").insert(rows);
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
