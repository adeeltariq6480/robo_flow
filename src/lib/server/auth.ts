import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/types/database";
import { redirect, notFound } from "next/navigation";

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function getProject(projectId: string): Promise<Project> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error || !data) notFound();
  return data;
}

export async function requireProject(projectId: string): Promise<Project> {
  await requireUser();
  return getProject(projectId);
}
