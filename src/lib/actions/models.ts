"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { ModelFormat } from "@/lib/types/database";

export async function registerModel(
  projectId: string,
  data: {
    name: string;
    description?: string | null;
    filePath: string;
    fileSize: number;
    format: ModelFormat;
    version: string;
  }
) {
  const supabase = createAdminClient();

  const { error } = await supabase.from("models").insert({
    project_id: projectId,
    name: data.name,
    description: data.description ?? null,
    file_path: data.filePath,
    file_size: data.fileSize,
    format: data.format,
    version: data.version,
    created_by: null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/models`);
  return { success: true };
}

export async function deleteModel(projectId: string, modelId: string) {
  const supabase = createAdminClient();

  const { data: model } = await supabase
    .from("models")
    .select("file_path")
    .eq("id", modelId)
    .single();

  if (model?.file_path) {
    await supabase.storage.from("models").remove([model.file_path]);
  }

  const { error } = await supabase
    .from("models")
    .delete()
    .eq("id", modelId)
    .eq("project_id", projectId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/models`);
  return { success: true };
}

export async function deleteModels(projectId: string, modelIds: string[]) {
  if (modelIds.length === 0) return { error: "No models selected" };

  const supabase = createAdminClient();

  for (const modelId of modelIds) {
    const { data: model } = await supabase
      .from("models")
      .select("file_path")
      .eq("id", modelId)
      .single();

    if (model?.file_path) {
      await supabase.storage.from("models").remove([model.file_path]);
    }

    const { error } = await supabase
      .from("models")
      .delete()
      .eq("id", modelId)
      .eq("project_id", projectId);

    if (error) return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/models`);
  return { success: true, count: modelIds.length };
}

export async function deleteAllModels(projectId: string) {
  const supabase = createAdminClient();
  const { data: models } = await supabase
    .from("models")
    .select("id")
    .eq("project_id", projectId);

  if (!models?.length) return { success: true, count: 0 };

  return deleteModels(
    projectId,
    models.map((m) => m.id)
  );
}
