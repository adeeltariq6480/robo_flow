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
    const [models, allDatasets] = await Promise.all([
      modelService.listModels(id),
      datasetService.listAllDatasets(id),
    ]);

    const datasets = allDatasets.map((d) =>
      datasetService.isStockCheckDataset(d.name)
        ? { ...d, name: "Stock check" }
        : d
    );

    const imageLists = await Promise.all(
      datasets.map((dataset) =>
        datasetService.listImagesByDataset(id, dataset.id)
      )
    );

    const imageFiles: DatasetFileOption[] = [];
    datasets.forEach((dataset, index) => {
      for (const img of imageLists[index]) {
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
    });

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
