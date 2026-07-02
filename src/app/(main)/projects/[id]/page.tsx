import * as projectService from "@/lib/services/projectService";
import { ProjectOverviewStats } from "@/components/project/project-overview-stats";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return runBackendPage(async () => {
    const stats = await projectService.getProjectStats(id);

    return (
      <ProjectOverviewStats
        projectId={id}
        classCount={stats.classCount}
        datasetCount={stats.datasetCount}
        modelCount={stats.modelCount}
        imageCount={stats.imageCount}
      />
    );
  });
}
