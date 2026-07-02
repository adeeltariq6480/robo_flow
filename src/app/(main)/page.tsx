import * as projectService from "@/lib/services/projectService";
import { ProjectsListClient } from "@/components/projects/projects-list-client";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function HomePage() {
  return runBackendPage(async () => {
    const projects = await projectService.listProjects();
    return <ProjectsListClient projects={projects} />;
  });
}
