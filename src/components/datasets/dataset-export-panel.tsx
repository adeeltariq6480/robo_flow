"use client";

import { useState } from "react";
import Link from "next/link";
import type { ExportFormat } from "@/lib/export/types";
import { EXPORT_FORMAT_LABELS } from "@/lib/export/types";
import { exportToHuggingFace, downloadExportZip } from "@/lib/services/exportService";
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
  const [exported, setExported] = useState<{ hfRepo: string; hfPath: string } | null>(
    null
  );

  async function handleDownload() {
    setLoading(true);
    setError(null);
    setExported(null);
    setExportProgress(8);

    const tick = window.setInterval(() => {
      setExportProgress((p) => (p >= 90 ? p : p + 4));
    }, 400);

    try {
      const { blob, fileName } = await downloadExportZip(projectId, format);
      setExportProgress(100);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      window.clearInterval(tick);
      setLoading(false);
      window.setTimeout(() => setExportProgress(0), 600);
    }
  }

  async function handleUploadToHf() {
    setLoading(true);
    setError(null);
    setExported(null);
    setExportProgress(8);

    const tick = window.setInterval(() => {
      setExportProgress((p) => (p >= 90 ? p : p + 4));
    }, 400);

    try {
      const result = await exportToHuggingFace(projectId, format);
      setExportProgress(100);
      setExported({ hfRepo: result.hfRepo, hfPath: result.hfPath });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
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
            <div className="relative mt-6">
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
                      disabled={loading}
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

              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/90 backdrop-blur-[1px]">
                  <CircularProgress
                    value={exportProgress}
                    label="Building export…"
                    sublabel="Downloading images and labels"
                  />
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={handleDownload} loading={loading}>
                {!loading && <Download className="h-4 w-4" />}
                {loading ? "Preparing zip…" : `Download ${EXPORT_FORMAT_LABELS[format].label}`}
              </Button>
              <Button
                variant="secondary"
                onClick={handleUploadToHf}
                loading={loading}
                disabled={loading}
              >
                Upload to Hugging Face
              </Button>
              <Link
                href={`/projects/${projectId}/datasets/${datasetId}/review?filter=approved`}
              >
                <Button variant="secondary">View approved</Button>
              </Link>
            </div>

            {exported && (
              <div className="mt-6">
                <Alert variant="success">
                  Export uploaded to Hugging Face:{" "}
                  <code className="text-xs">
                    {exported.hfRepo}/{exported.hfPath}
                  </code>
                </Alert>
              </div>
            )}

            <p className="mt-4 text-xs text-slate-500">
              Only <strong>approved</strong> images are included. The ZIP contains
              image files plus labels (YOLO: <code>images/</code> +{" "}
              <code>labels/*.txt</code> + <code>classes.txt</code> +{" "}
              <code>data.yaml</code>). Use <strong>Download</strong> to save locally,
              or <strong>Upload to Hugging Face</strong> to store a copy in your HF
              repo under <code>exports/</code>.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
