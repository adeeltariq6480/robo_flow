import { getProject } from "@/lib/server/auth";
import * as modelService from "@/lib/services/modelService";
import { ModelsPageClient } from "@/components/models/models-page-client";
import { backendErrorPage } from "@/lib/server/backend-page";

export default async function ModelsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  try {
    await getProject(id);
    const models = await modelService.listModels(id);
    return <ModelsPageClient projectId={id} models={models} />;
  } catch (err) {
    const page = backendErrorPage(err);
    if (page) return page;
    throw err;
  }
}
