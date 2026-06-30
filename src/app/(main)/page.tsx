import * as projectService from "@/lib/services/projectService";
import { ProjectsListClient } from "@/components/projects/projects-list-client";
import { BackendSetupRequired } from "@/components/layout/backend-setup-required";
import { ApiError, BackendUnavailableError } from "@/lib/api/client";

export default async function HomePage() {
  try {
    const projects = await projectService.listProjects();
    return <ProjectsListClient projects={projects} />;
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      return <BackendSetupRequired message={err.message} />;
    }
    if (err instanceof ApiError && err.status === 401) {
      return (
        <BackendSetupRequired
          message={
            "Backend rejected the API key (401). On Vercel set WORKER_API_KEY to the same " +
            "value as Railway, or remove WORKER_API_KEY on Railway for open no-auth mode."
          }
        />
      );
    }
    throw err;
  }
}
