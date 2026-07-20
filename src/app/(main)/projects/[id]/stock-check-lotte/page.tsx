import * as modelService from "@/lib/services/modelService";
import { runBackendPage } from "@/lib/server/backend-page";
import { StockCheckLotte } from "@/components/inventory/stock-check-lotte";

export default async function StockCheckLottePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runBackendPage(async () => (
    <StockCheckLotte
      projectId={id}
      modelIds={(await modelService.listModels(id)).map((model) => String(model.id))}
    />
  ));
}
