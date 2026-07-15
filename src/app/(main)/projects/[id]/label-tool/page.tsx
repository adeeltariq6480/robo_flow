import { LabelToolClient } from "@/components/label-tool/label-tool-client";

export default async function LabelToolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LabelToolClient projectId={id} />;
}
