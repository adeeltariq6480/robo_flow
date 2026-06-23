import { createClient } from "@/lib/supabase/server";
import { requireProject } from "@/lib/server/auth";
import { ModelsPageClient } from "@/components/models/models-page-client";

export default async function ModelsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireProject(id);

  const supabase = await createClient();
  const { data: models } = await supabase
    .from("models")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  return <ModelsPageClient projectId={id} models={models ?? []} />;
}
