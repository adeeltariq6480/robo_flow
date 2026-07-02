import { cache } from "react";
import { getProjectById as fetchProjectById } from "@/lib/services/projectService";
import { isBackendUnavailableError, isNextRedirect } from "@/lib/api/errors";
import { redirect } from "next/navigation";

/**
 * Project existence guard for project-scoped pages. No authentication —
 * the app is fully open. Redirects to the project list if the id is invalid.
 * Cached per request so layout + pages share one backend call.
 */
export const getProject = cache(async (projectId: string) => {
  try {
    const project = await fetchProjectById(projectId);
    if (!project) redirect("/");
    return project;
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    if (isBackendUnavailableError(err)) {
      redirect("/");
    }
    throw err;
  }
});
