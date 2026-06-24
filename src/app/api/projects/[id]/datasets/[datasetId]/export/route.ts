import { NextResponse } from "next/server";
import {
  buildExportArtifact,
  loadApprovedExportData,
} from "@/lib/export/build";
import type { ExportFormat } from "@/lib/export/types";

const FORMATS: ExportFormat[] = ["yolo", "coco", "voc", "csv"];

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; datasetId: string }> }
) {
  const { id: projectId, datasetId } = await context.params;
  const { searchParams } = new URL(request.url);
  const formatParam = searchParams.get("format") ?? "yolo";

  if (!FORMATS.includes(formatParam as ExportFormat)) {
    return NextResponse.json(
      { error: `Invalid format. Use one of: ${FORMATS.join(", ")}` },
      { status: 400 }
    );
  }

  const format = formatParam as ExportFormat;

  const loaded = await loadApprovedExportData(projectId, datasetId);
  if (loaded.error || !loaded.data) {
    return NextResponse.json(
      { error: loaded.error ?? "Export failed" },
      { status: loaded.approvedCount === 0 ? 404 : 500 }
    );
  }

  try {
    const artifact = await buildExportArtifact(loaded.data, format);
    return new NextResponse(new Uint8Array(artifact.buffer), {
      status: 200,
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
