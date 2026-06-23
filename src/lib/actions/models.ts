"use server";

import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("models").insert({
    project_id: projectId,
    name: data.name,
    description: data.description ?? null,
    file_path: data.filePath,
    file_size: data.fileSize,
    format: data.format,
    version: data.version,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/models`);
  return { success: true };
}

export async function deleteModel(projectId: string, modelId: string) {
  const supabase = await createClient();

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
