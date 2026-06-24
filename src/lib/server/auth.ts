import { createAdminClient } from "@/lib/supabase/admin";
import type { Project } from "@/lib/types/database";
import { notFound } from "next/navigation";

export async function getProject(projectId: string): Promise<Project> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error || !data) notFound();
  return data as Project;
}
