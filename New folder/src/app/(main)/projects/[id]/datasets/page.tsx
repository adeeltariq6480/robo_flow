import { getProject } from "@/lib/server/auth";
import * as datasetService from "@/lib/services/datasetService";
import * as modelService from "@/lib/services/modelService";
import { DatasetsPageClient } from "@/components/datasets/datasets-page-client";

export default async function DatasetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await getProject(id);

  const [datasets, modelCount] = await Promise.all([
    datasetService.listDatasets(id),
    modelService.getModelCount(id),
  ]);

  return (
    <DatasetsPageClient
      projectId={id}
      datasets={datasets}
      hasModels={modelCount > 0}
    />
  );
}
