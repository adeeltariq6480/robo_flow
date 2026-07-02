import { getProject } from "@/lib/server/auth";
import * as modelService from "@/lib/services/modelService";
import * as datasetService from "@/lib/services/datasetService";
import { InferencePageClient } from "@/components/inference/inference-page-client";
import { toClientModels } from "@/lib/serialize/model";
import type { DatasetFileOption } from "@/components/inference/test-run-panel";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function InferencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return runBackendPage(async () => {
    await getProject(id);

    const [models, datasets] = await Promise.all([
      modelService.listModels(id),
      datasetService.listDatasets(id),
    ]);

    const imageFiles: DatasetFileOption[] = [];
    for (const dataset of datasets) {
      const images = await datasetService.listImagesByDataset(id, dataset.id);
      for (const img of images) {
        const mime = img.mimeType ?? "";
        const name = img.fileName?.toLowerCase() ?? "";
        if (
          !mime.startsWith("image/") &&
          !/\.(jpg|jpeg|png|webp|bmp|gif)$/.test(name)
        ) {
          continue;
        }
        imageFiles.push({
          id: img.id,
          file_name: img.fileName,
          dataset_id: img.datasetId,
          dataset_name: dataset.name,
        });
      }
    }

    return (
      <InferencePageClient
        projectId={id}
        models={toClientModels(models)}
        datasets={datasets}
        files={imageFiles}
      />
    );
  });
}
