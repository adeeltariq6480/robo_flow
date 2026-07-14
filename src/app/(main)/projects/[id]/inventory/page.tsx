import * as datasetService from "@/lib/services/datasetService";
import { InventoryPanel } from "@/components/inventory/inventory-panel";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ datasetId?: string }>;
}) {
  const { id } = await params;
  const { datasetId } = await searchParams;

  return runBackendPage(async () => {
    const datasets = await datasetService.listDatasets(id);
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Stock check</h1>
          <p className="mt-1 text-sm text-slate-500">
            Check labeled images — see Pepsi 250ml / 500ml / 7up counts per photo.
          </p>
        </div>
        <InventoryPanel
          projectId={id}
          datasets={datasets}
          defaultDatasetId={datasetId}
        />
      </div>
    );
  });
}
