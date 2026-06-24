import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProject } from "@/lib/server/auth";
import { AutoLabelPanel } from "@/components/inference/auto-label-panel";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { Dataset, Model } from "@/lib/types/database";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

export default async function DatasetLabelPage({
  params,
}: {
  params: Promise<{ id: string; datasetId: string }>;
}) {
  const { id: projectId, datasetId } = await params;
  await getProject(projectId);

  const supabase = createAdminClient();
  const [{ data: dataset }, { data: models }] = await Promise.all([
    supabase
      .from("datasets")
      .select("*")
      .eq("id", datasetId)
      .eq("project_id", projectId)
      .single(),
    supabase
      .from("models")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);

  if (!dataset) notFound();

  const modelList = (models ?? []) as Model[];
  const reviewHref = `/projects/${projectId}/datasets/${datasetId}/review?filter=needs_review`;

  return (
    <div className="space-y-6">
      <Link href={`/projects/${projectId}/datasets`}>
        <Button variant="secondary">
          <ArrowLeft className="h-4 w-4" />
          Datasets
        </Button>
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Label dataset: {dataset.name}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {dataset.file_count} image{dataset.file_count !== 1 ? "s" : ""} — model se
          sab par bounding boxes lagayenge
        </p>
      </div>

      {dataset.file_count === 0 ? (
        <Alert variant="error">
          Is dataset mein koi image nahi. Pehle{" "}
          <Link
            href={`/projects/${projectId}/datasets/${datasetId}/upload`}
            className="underline"
          >
            images upload
          </Link>{" "}
          karein.
        </Alert>
      ) : modelList.length === 0 ? (
        <Alert variant="error">
          Koi model nahi. Pehle{" "}
          <Link href={`/projects/${projectId}/models/upload`} className="underline">
            YOLO model (.pt) upload
          </Link>{" "}
          karein.
        </Alert>
      ) : (
        <AutoLabelPanel
          projectId={projectId}
          models={modelList}
          datasets={[dataset as Dataset]}
          defaultDatasetId={datasetId}
          lockDataset
          reviewHref={reviewHref}
        />
      )}
    </div>
  );
}
