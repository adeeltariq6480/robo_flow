import { createAdminClient } from "@/lib/supabase/admin";
import { getProject } from "@/lib/server/auth";
import { ModelsPageClient } from "@/components/models/models-page-client";
import { toClientModels } from "@/lib/serialize/model";

export default async function ModelsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await getProject(id);

  const supabase = createAdminClient();
  const { data: models } = await supabase
    .from("models")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  return (
    <ModelsPageClient projectId={id} models={toClientModels(models)} />
  );
}
