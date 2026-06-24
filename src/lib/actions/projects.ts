"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createProject(formData: FormData) {
  const supabase = createAdminClient();
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) return { error: "Project name is required" };

  const { data, error } = await supabase
    .from("projects")
    .insert({ name, description, created_by: null })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/");
  redirect(`/projects/${data.id}`);
}

export async function deleteProject(projectId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath("/");
  redirect("/");
}

export async function deleteProjects(projectIds: string[]) {
  if (projectIds.length === 0) return { error: "No projects selected" };

  const supabase = createAdminClient();
  const { error } = await supabase.from("projects").delete().in("id", projectIds);
  if (error) return { error: error.message };

  revalidatePath("/");
  return { success: true, count: projectIds.length };
}

export async function deleteAllProjects() {
  const supabase = createAdminClient();
  const { data: projects } = await supabase.from("projects").select("id");
  if (!projects?.length) return { success: true, count: 0 };

  return deleteProjects(projects.map((p) => p.id));
}
