import { createClient } from "@/lib/supabase/server";
import { requireProject } from "@/lib/server/auth";
import { DatasetsPageClient } from "@/components/datasets/datasets-page-client";

export default async function DatasetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireProject(id);

  const supabase = await createClient();
  const { data: datasets } = await supabase
    .from("datasets")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  return <DatasetsPageClient projectId={id} datasets={datasets ?? []} />;
}
