import { getApprovedExportStats } from "@/lib/export/build";
import { getProject } from "@/lib/server/auth";
import * as datasetService from "@/lib/services/datasetService";
import * as classService from "@/lib/services/classService";
import { DatasetExportPanel } from "@/components/datasets/dataset-export-panel";
import { notFound } from "next/navigation";

export default async function DatasetExportPage({
  params,
}: {
  params: Promise<{ id: string; datasetId: string }>;
}) {
  const { id: projectId, datasetId } = await params;
  await getProject(projectId);

  const dataset = await datasetService.getDataset(projectId, datasetId);
  if (!dataset) notFound();

  const [stats, classCount] = await Promise.all([
    getApprovedExportStats(projectId, datasetId),
    classService.getClassCount(projectId),
  ]);

  return (
    <DatasetExportPanel
      projectId={projectId}
      datasetId={datasetId}
      datasetName={dataset.name}
      approvedCount={stats.approvedCount ?? 0}
      classCount={classCount}
    />
  );
}
