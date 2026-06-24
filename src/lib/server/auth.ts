import { getProjectById } from "@/lib/services/projectService";
import { getSessionUser } from "@/lib/services/authService";
import { redirect } from "next/navigation";

export async function getProject(projectId: string) {
  const project = await getProjectById(projectId);
  if (!project) redirect("/");
  return project;
}

export async function getCurrentUser() {
  return getSessionUser();
}
