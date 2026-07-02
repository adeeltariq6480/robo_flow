import Link from "next/link";
import * as datasetService from "@/lib/services/datasetService";
import * as modelService from "@/lib/services/modelService";
import { AutoLabelPanel } from "@/components/inference/auto-label-panel";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { toClientModels } from "@/lib/serialize/model";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function DatasetLabelPage({
  params,
}: {
  params: Promise<{ id: string; datasetId: string }>;
}) {
  const { id: projectId, datasetId } = await params;

  return runBackendPage(async () => {
    const [dataset, models] = await Promise.all([
      datasetService.getDataset(projectId, datasetId),
      modelService.listModels(projectId),
    ]);

    if (!dataset) notFound();

    const modelList = toClientModels(models);
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
            datasets={[dataset]}
            defaultDatasetId={datasetId}
            lockDataset
            reviewHref={reviewHref}
          />
        )}
      </div>
    );
  });
}
