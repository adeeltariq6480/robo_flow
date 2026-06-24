"use server";

import * as projectService from "@/lib/services/projectService";
import { getSessionUser } from "@/lib/services/authService";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionResult } from "@/lib/actions/types";

export async function createProject(formData: FormData): Promise<ActionResult | void> {
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) return { error: "Project name is required" };

  try {
    const user = await getSessionUser();
    const id = await projectService.createProject({
      name,
      description,
      createdBy: user?.uid ?? null,
    });

    revalidatePath("/");
    redirect(`/projects/${id}`);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create project" };
  }
}

export async function deleteProject(projectId: string): Promise<ActionResult | void> {
  try {
    await projectService.deleteProject(projectId);
    revalidatePath("/");
    redirect("/");
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete project" };
  }
}

export async function deleteProjects(projectIds: string[]): Promise<ActionResult> {
  try {
    if (projectIds.length === 0) return { error: "No projects selected" };
    await projectService.deleteProjects(projectIds);
    revalidatePath("/");
    return { success: true, count: projectIds.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete projects" };
  }
}

export async function deleteAllProjects(): Promise<ActionResult> {
  try {
    const projects = await projectService.listProjects();
    if (!projects.length) return { success: true, count: 0 };
    return deleteProjects(projects.map((p) => p.id));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete projects" };
  }
}
