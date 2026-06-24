import * as projectService from "@/lib/services/projectService";
import { ProjectsListClient } from "@/components/projects/projects-list-client";

export default async function HomePage() {
  const projects = await projectService.listProjects();
  return <ProjectsListClient projects={projects} />;
}
