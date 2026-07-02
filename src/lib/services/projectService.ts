import { cache } from "react";
import { api } from "@/lib/api/client";
import { toProject } from "@/lib/firebase/adapters";
import type { FirestoreProject } from "@/lib/types/firestore";
import type { Project } from "@/lib/types/database";

export const listProjects = cache(async (): Promise<Project[]> => {
  const rows = await api.get<FirestoreProject[]>("/api/projects");
  return rows.map((r) => toProject(r));
});

export const getProjectById = cache(async (projectId: string): Promise<Project | null> => {
  try {
    const row = await api.get<FirestoreProject>(`/api/projects/${projectId}`);
    return toProject(row);
  } catch {
    return null;
  }
});

export async function createProject(data: {
  name: string;
  description?: string | null;
}): Promise<string> {
  const row = await api.post<FirestoreProject>("/api/projects", {
    name: data.name,
    description: data.description ?? null,
    annotationType: "bounding_box",
  });
  return row.id;
}

export async function deleteProject(projectId: string) {
  await api.del(`/api/projects/${projectId}`);
}

export async function deleteProjects(projectIds: string[]) {
  await Promise.all(projectIds.map((id) => deleteProject(id)));
}

export const getProjectStats = cache(async (projectId: string) => {
  return api.get<{
    classCount: number;
    datasetCount: number;
    modelCount: number;
    imageCount: number;
  }>(`/api/projects/${projectId}/stats`);
});
