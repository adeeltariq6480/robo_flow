import * as projectService from "@/lib/services/projectService";
import { ProjectsListClient } from "@/components/projects/projects-list-client";
import { backendErrorPage } from "@/lib/server/backend-page";
export default async function HomePage() {
  try {
    const projects = await projectService.listProjects();
    return <ProjectsListClient projects={projects} />;
  } catch (err) {
    const page = backendErrorPage(err);
    if (page) return page;
    throw err;
  }
}
