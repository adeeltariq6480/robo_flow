import { getProject } from "@/lib/server/auth";
import * as modelService from "@/lib/services/modelService";
import { ModelsPageClient } from "@/components/models/models-page-client";

export default async function ModelsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await getProject(id);
  const models = await modelService.listModels(id);

  return <ModelsPageClient projectId={id} models={models} />;
}
