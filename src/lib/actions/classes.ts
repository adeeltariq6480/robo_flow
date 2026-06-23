"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { CLASS_COLORS } from "@/lib/utils";

export async function createClass(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const color = (formData.get("color") as string) || CLASS_COLORS[0];

  if (!name) return { error: "Class name is required" };

  const { count } = await supabase
    .from("classes")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { error } = await supabase.from("classes").insert({
    project_id: projectId,
    name,
    description,
    color,
    sort_order: count ?? 0,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/classes`);
  return { success: true };
}

export async function updateClass(
  projectId: string,
  classId: string,
  formData: FormData
) {
  const supabase = await createClient();
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const color = formData.get("color") as string;

  if (!name) return { error: "Class name is required" };

  const { error } = await supabase
    .from("classes")
    .update({ name, description, color })
    .eq("id", classId)
    .eq("project_id", projectId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/classes`);
  return { success: true };
}

export async function deleteClass(projectId: string, classId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("classes")
    .delete()
    .eq("id", classId)
    .eq("project_id", projectId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/classes`);
  return { success: true };
}
