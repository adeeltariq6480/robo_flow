import { getProjectById } from "@/lib/services/projectService";
import { redirect } from "next/navigation";

/**
 * Project existence guard for project-scoped pages. No authentication —
 * the app is fully open. Redirects to the project list if the id is invalid.
 */
export async function getProject(projectId: string) {
  const project = await getProjectById(projectId);
  if (!project) redirect("/");
  return project;
}
