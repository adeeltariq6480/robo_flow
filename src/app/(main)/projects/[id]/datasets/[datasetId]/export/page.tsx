import { createAdminClient } from "@/lib/supabase/admin";
import { getApprovedExportStats } from "@/lib/export/build";
import { getProject } from "@/lib/server/auth";
import { DatasetExportPanel } from "@/components/datasets/dataset-export-panel";
import { notFound } from "next/navigation";

export default async function DatasetExportPage({
  params,
}: {
  params: Promise<{ id: string; datasetId: string }>;
}) {
  const { id: projectId, datasetId } = await params;
  await getProject(projectId);

  const supabase = createAdminClient();
  const { data: dataset } = await supabase
    .from("datasets")
    .select("name")
    .eq("id", datasetId)
    .eq("project_id", projectId)
    .single();

  if (!dataset) notFound();

  const stats = await getApprovedExportStats(projectId, datasetId);
  const { count: classCount } = await supabase
    .from("classes")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  return (
    <DatasetExportPanel
      projectId={projectId}
      datasetId={datasetId}
      datasetName={dataset.name}
      approvedCount={stats.approvedCount ?? 0}
      classCount={classCount ?? 0}
    />
  );
}
