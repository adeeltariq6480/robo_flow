import { createAdminClient } from "@/lib/supabase/admin";
import { getProject } from "@/lib/server/auth";
import { DatasetsPageClient } from "@/components/datasets/datasets-page-client";
import type { Dataset } from "@/lib/types/database";

export default async function DatasetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await getProject(id);

  const supabase = createAdminClient();
  const { data: datasets } = await supabase
    .from("datasets")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  const { count: modelCount } = await supabase
    .from("models")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id);

  return (
    <DatasetsPageClient
      projectId={id}
      datasets={(datasets ?? []) as Dataset[]}
      hasModels={(modelCount ?? 0) > 0}
    />
  );
}
