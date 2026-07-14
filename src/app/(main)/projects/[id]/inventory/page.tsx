import * as datasetService from "@/lib/services/datasetService";
import { InventoryPanel } from "@/components/inventory/inventory-panel";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return runBackendPage(async () => {
    const stock = await datasetService.ensureStockCheckDataset(id);
    return (
      <div className="mx-auto max-w-5xl space-y-2 p-6">
        <InventoryPanel projectId={id} stockCheckDatasetId={stock.id} />
      </div>
    );
  });
}
