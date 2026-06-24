"use client";

import { useState } from "react";
import Link from "next/link";
import type { ExportFormat } from "@/lib/export/types";
import { EXPORT_FORMAT_LABELS } from "@/lib/export/types";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CircularProgress } from "@/components/ui/circular-progress";
import { ArrowLeft, Download, FileArchive, FileJson, FileSpreadsheet } from "lucide-react";

interface DatasetExportPanelProps {
  projectId: string;
  datasetId: string;
  datasetName: string;
  approvedCount: number;
  classCount: number;
}

const FORMAT_ICONS: Record<ExportFormat, typeof FileArchive> = {
  yolo: FileArchive,
  coco: FileJson,
  voc: FileArchive,
  csv: FileSpreadsheet,
};

export function DatasetExportPanel({
  projectId,
  datasetId,
  datasetName,
  approvedCount,
  classCount,
}: DatasetExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>("yolo");
  const [loading, setLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setLoading(true);
    setError(null);
    setExportProgress(8);

    const url = `/api/projects/${projectId}/datasets/${datasetId}/export?format=${format}`;
    const tick = window.setInterval(() => {
      setExportProgress((p) => (p >= 90 ? p : p + 4));
    }, 400);

    try {
      const res = await fetch(url);
      setExportProgress(95);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Export failed (${res.status})`
        );
      }

      const blob = await res.blob();
      setExportProgress(100);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName =
        match?.[1] ??
        `${datasetName}.${EXPORT_FORMAT_LABELS[format].extension}`;

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      window.clearInterval(tick);
      setLoading(false);
      window.setTimeout(() => setExportProgress(0), 600);
    }
  }

  const formats = Object.keys(EXPORT_FORMAT_LABELS) as ExportFormat[];

  return (
    <div className="space-y-6">
      <Link href={`/projects/${projectId}/datasets`}>
        <Button variant="secondary">
          <ArrowLeft className="h-4 w-4" />
          Datasets
        </Button>
      </Link>

      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="Export dataset"
          description={`${datasetName} — approved labels only`}
        />

        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-medium uppercase text-slate-500">
              Approved images
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {approvedCount}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-medium uppercase text-slate-500">
              Classes
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {classCount}
            </p>
          </div>
        </div>

        {approvedCount === 0 ? (
          <Alert variant="error">
            No approved images yet.{" "}
            <Link
              href={`/projects/${projectId}/datasets/${datasetId}/review?filter=needs_review`}
              className="underline"
            >
              Review and approve labels
            </Link>{" "}
            before exporting.
          </Alert>
        ) : (
          <>
            <p className="mb-3 text-sm font-medium text-slate-700">
              Export format
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {formats.map((f) => {
                const meta = EXPORT_FORMAT_LABELS[f];
                const Icon = FORMAT_ICONS[f];
                const active = format === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 h-5 w-5 shrink-0 ${
                        active ? "text-brand-600" : "text-slate-400"
                      }`}
                    />
                    <div>
                      <p className="font-medium text-slate-900">{meta.label}</p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {meta.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={handleDownload} disabled={loading}>
                <Download className="h-4 w-4" />
                {loading ? "Preparing zip…" : `Download ${EXPORT_FORMAT_LABELS[format].label}`}
              </Button>
              <Link
                href={`/projects/${projectId}/datasets/${datasetId}/review?filter=approved`}
              >
                <Button variant="secondary">View approved</Button>
              </Link>
            </div>

            {loading && (
              <div className="mt-6 flex justify-center py-2">
                <CircularProgress
                  value={exportProgress}
                  label="Building export zip…"
                  sublabel="Labels + images in one file"
                />
              </div>
            )}

            <p className="mt-4 text-xs text-slate-500">
              Only images with review status <strong>approved</strong> are
              included. The zip contains <strong>images/</strong> plus label
              files (YOLO TXT, VOC XML, COCO JSON, or CSV depending on format).
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
