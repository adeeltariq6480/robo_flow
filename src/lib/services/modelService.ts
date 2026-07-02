import { cache } from "react";
import { api } from "@/lib/api/client";
import { toModel } from "@/lib/firebase/adapters";
import type { FirestoreModel } from "@/lib/types/firestore";
import type { Model } from "@/lib/types/database";

export const listModels = cache(async (projectId: string): Promise<Model[]> => {
  const rows = await api.get<FirestoreModel[]>(`/api/models/${projectId}`);
  return rows.map((r) => toModel(projectId, r));
});

export const getModelCount = cache(async (projectId: string): Promise<number> => {
  return (await listModels(projectId)).length;
});

export async function deleteModel(projectId: string, modelId: string) {
  await api.del(`/api/models/${projectId}/${modelId}`);
}

export async function deleteModels(projectId: string, modelIds: string[]) {
  await Promise.all(modelIds.map((id) => deleteModel(projectId, id)));
}
