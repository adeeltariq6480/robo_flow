import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProject } from "@/lib/server/auth";
import { DatasetUploadForm } from "@/components/datasets/dataset-upload-form";
import type { Dataset, Class } from "@/lib/types/database";

export default async function DatasetUploadPage({
  params,
}: {
  params: Promise<{ id: string; datasetId: string }>;
}) {
  const { id, datasetId } = await params;
  await getProject(id);

  const supabase = createAdminClient();
  const [datasetResult, classesResult] = await Promise.all([
    supabase.from("datasets").select("*").eq("id", datasetId).eq("project_id", id).single(),
    supabase.from("classes").select("*").eq("project_id", id).order("sort_order"),
  ]);

  const dataset = datasetResult.data as Dataset | null;
  const classes = (classesResult.data ?? []) as Class[];

  if (!dataset) notFound();

  return (
    <div>
      <Link href={`/projects/${id}/datasets`} className="mb-6 inline-block text-sm text-slate-500 hover:text-slate-700">
        ← Back to datasets
      </Link>
      <DatasetUploadForm projectId={id} datasetId={datasetId} datasetName={dataset.name} classes={classes} />
    </div>
  );
}
