"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseClassNamesInput } from "@/lib/classes/constants";
import { revalidatePath } from "next/cache";
import { CLASS_COLORS } from "@/lib/utils";

export async function createClass(projectId: string, formData: FormData) {
  const supabase = createAdminClient();
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

export async function createClassesBulk(projectId: string, formData: FormData) {
  const supabase = createAdminClient();
  const raw = (formData.get("names") as string) ?? "";
  const names = parseClassNamesInput(raw);

  if (names.length === 0) {
    return { error: "Enter at least one class name (one per line, comma-separated, or JSON array)" };
  }

  const { count } = await supabase
    .from("classes")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  const startOrder = count ?? 0;
  const rows = names.map((name, i) => ({
    project_id: projectId,
    name,
    description: null,
    color: CLASS_COLORS[(startOrder + i) % CLASS_COLORS.length],
    sort_order: startOrder + i,
  }));

  const { error } = await supabase.from("classes").insert(rows);
  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/classes`);
  return { success: true, count: names.length };
}

export async function updateClass(
  projectId: string,
  classId: string,
  formData: FormData
) {
  const supabase = createAdminClient();
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
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("classes")
    .delete()
    .eq("id", classId)
    .eq("project_id", projectId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/classes`);
  return { success: true };
}

export async function deleteClasses(projectId: string, classIds: string[]) {
  if (classIds.length === 0) return { error: "No classes selected" };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("classes")
    .delete()
    .eq("project_id", projectId)
    .in("id", classIds);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/classes`);
  return { success: true, count: classIds.length };
}

export async function deleteAllClasses(projectId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("classes")
    .delete()
    .eq("project_id", projectId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/classes`);
  return { success: true };
}
