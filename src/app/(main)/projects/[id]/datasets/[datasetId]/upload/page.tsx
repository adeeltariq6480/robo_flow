import Link from "next/link";
import { notFound } from "next/navigation";
import * as datasetService from "@/lib/services/datasetService";
import * as classService from "@/lib/services/classService";
import { DatasetUploadForm } from "@/components/datasets/dataset-upload-form";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function DatasetUploadPage({
  params,
}: {
  params: Promise<{ id: string; datasetId: string }>;
}) {
  const { id, datasetId } = await params;

  return runBackendPage(async () => {
    const [dataset, classes] = await Promise.all([
      datasetService.getDataset(id, datasetId),
      classService.listClasses(id),
    ]);

    if (!dataset) notFound();

    return (
      <div>
        <Link
          href={`/projects/${id}/datasets`}
          className="mb-6 inline-block text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to datasets
        </Link>
        <DatasetUploadForm
          projectId={id}
          datasetId={datasetId}
          datasetName={dataset.name}
          classes={classes}
        />
      </div>
    );
  });
}
