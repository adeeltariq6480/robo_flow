import { createAdminClient } from "@/lib/supabase/admin";
import { getProject } from "@/lib/server/auth";
import { InferencePageClient } from "@/components/inference/inference-page-client";
import type { Model, Dataset } from "@/lib/types/database";
import type { DatasetFileOption } from "@/components/inference/test-run-panel";

export default async function InferencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await getProject(id);
  const supabase = createAdminClient();

  const [modelsRes, datasetsRes, filesRes] = await Promise.all([
    supabase.from("models").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("datasets").select("*").eq("project_id", id).order("name"),
    supabase
      .from("dataset_files")
      .select("id, file_name, dataset_id, mime_type, datasets(name)")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const models = (modelsRes.data ?? []) as Model[];
  const datasets = (datasetsRes.data ?? []) as Dataset[];

  const imageFiles: DatasetFileOption[] = (filesRes.data ?? [])
    .filter((f) => {
      const mime = f.mime_type ?? "";
      const name = f.file_name?.toLowerCase() ?? "";
      return (
        mime.startsWith("image/") ||
        /\.(jpg|jpeg|png|webp|bmp|gif)$/.test(name)
      );
    })
    .map((f) => {
      const ds = f.datasets as { name: string } | { name: string }[] | null;
      const datasetName = Array.isArray(ds) ? ds[0]?.name : ds?.name;
      return {
        id: f.id,
        file_name: f.file_name,
        dataset_id: f.dataset_id,
        dataset_name: datasetName ?? "Dataset",
      };
    });

  return (
    <InferencePageClient
      projectId={id}
      models={models}
      datasets={datasets}
      files={imageFiles}
    />
  );
}
