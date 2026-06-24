import { createAdminClient } from "@/lib/supabase/admin";
import type { Project } from "@/lib/types/database";
import { notFound } from "next/navigation";

export async function getProject(projectId: string): Promise<Project> {
  if (
    projectId === "new" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      projectId
    )
  ) {
    notFound();
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    console.error("getProject:", error.message);
    notFound();
  }
  if (!data) notFound();
  return data as Project;
}
