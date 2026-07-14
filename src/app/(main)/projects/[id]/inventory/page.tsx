import * as datasetService from "@/lib/services/datasetService";
import * as modelService from "@/lib/services/modelService";
import { InventoryPanel } from "@/components/inventory/inventory-panel";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return runBackendPage(async () => {
    const [stock, models] = await Promise.all([
      datasetService.ensureStockCheckDataset(id),
      modelService.listModels(id),
    ]);
    return (
      <div className="mx-auto max-w-5xl space-y-2 p-6">
        <InventoryPanel
          projectId={id}
          stockCheckDatasetId={stock.id}
          modelIds={models.map((m) => String(m.id))}
        />
      </div>
    );
  });
}
