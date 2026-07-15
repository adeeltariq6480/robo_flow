import { ManualLabelTool } from "@/components/label-tool/manual-label-tool";

export default async function LabelToolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManualLabelTool projectId={id} />;
}
