import * as projectService from "@/lib/services/projectService";
import { ProjectsListClient } from "@/components/projects/projects-list-client";
import { BackendSetupRequired } from "@/components/layout/backend-setup-required";
import { BackendUnavailableError } from "@/lib/api/client";

export default async function HomePage() {
  try {
    const projects = await projectService.listProjects();
    return <ProjectsListClient projects={projects} />;
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      return <BackendSetupRequired message={err.message} />;
    }
    throw err;
  }
}
