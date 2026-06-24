"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export async function listProjectDatasetsBrief(projectId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("datasets")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");

  if (error) return { error: error.message, datasets: [] as { id: string; name: string }[] };
  return { datasets: data ?? [] };
}
