import { LabelToolClient } from "@/components/label-tool/label-tool-client";
import * as modelService from "@/lib/services/modelService";
import { toClientModels } from "@/lib/serialize/model";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function LabelToolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runBackendPage(async () => <LabelToolClient projectId={id} models={toClientModels(await modelService.listModels(id))} />);
}
