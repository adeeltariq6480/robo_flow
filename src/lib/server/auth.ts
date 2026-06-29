import { getProjectById } from "@/lib/services/projectService";
import { BackendUnavailableError } from "@/lib/api/client";
import { redirect } from "next/navigation";

/**
 * Project existence guard for project-scoped pages. No authentication —
 * the app is fully open. Redirects to the project list if the id is invalid.
 */
export async function getProject(projectId: string) {
  try {
    const project = await getProjectById(projectId);
    if (!project) redirect("/");
    return project;
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      redirect("/");
    }
    throw err;
  }
}
