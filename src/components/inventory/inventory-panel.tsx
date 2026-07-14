"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchDatasetInventory } from "@/lib/actions/inventory";
import {
  deleteAllDatasetFiles,
  deleteDatasetFiles,
} from "@/lib/actions/datasets";
import { openColabLaunch } from "@/lib/actions/colab";
import { fetchJobStatus, startAutoLabel } from "@/lib/actions/inference";
import { uploadImages } from "@/lib/api/uploads";
import { imageContentUrl } from "@/lib/api/client";
import { setDeleteStatus } from "@/lib/delete-status";
import {
  startStockCsvDownloadJob,
  subscribeCsvDownloadProgress,
} from "@/lib/csv-download-job";
import type { StockCsvColumn } from "@/lib/stock-csv-download";
import {
  displayTestName,
  nextTestImageIndex,
  renameAsTestImage,
} from "@/lib/stock-test-names";
import type { DatasetInventory } from "@/lib/worker/client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { StockSimilarComparePanel } from "@/components/inventory/stock-similar-compare";
import { StockCsvDetectionPanel } from "@/components/inventory/stock-csv-detection";
import { Download, RefreshCw, Trash2, Upload, X } from "lucide-react";

interface InventoryPanelProps {
  projectId: string;
  /** Hidden Stock check scratch dataset id — not shown in Datasets. */
  stockCheckDatasetId: string;
  /** Project models used to count products after upload (no manual label). */
  modelIds: string[];
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

export function InventoryPanel({
  projectId,
  stockCheckDatasetId,
  modelIds,
}: InventoryPanelProps) {
  const datasetId = stockCheckDatasetId;
  const [data, setData] = useState<DatasetInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkLabel, setCheckLabel] = useState("");
  const [showLabelResults, setShowLabelResults] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [csvColumn, setCsvColumn] = useState<StockCsvColumn>("result");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvDownloading, setCsvDownloading] = useState(false);
  const [csvProgress, setCsvProgress] = useState("");
  const [csvProgressPct, setCsvProgressPct] = useState(0);
  /** 0 = all; otherwise max images in ZIP */
  const [downloadLimit, setDownloadLimit] = useState(50);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const checkAbortRef = useRef(false);

  async function load() {
    if (!datasetId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await fetchDatasetInventory(projectId, datasetId);
    if ("error" in result) {
      setError(result.error);
      setData(null);
    } else {
      setData(result);
      setShowLabelResults(true);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    return () => {
      checkAbortRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, datasetId]);

  useEffect(() => {
    return subscribeCsvDownloadProgress((p) => {
      setCsvProgress(p.label);
      setCsvProgressPct(
        p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
      );
      if (p.status === "running") setCsvDownloading(true);
      if (p.status === "done" || p.status === "error") {
        setCsvDownloading(false);
        if (p.status === "error") setError(p.label);
      }
    });
  }, []);

  const labeled = useMemo(() => data?.images ?? [], [data]);

  async function waitForCheckResults(jobId: string | undefined) {
    checkAbortRef.current = false;
    setChecking(true);
    setCheckLabel("Models se product counts nikaal rahe hain…");

    const maxRounds = 90; // ~7.5 min @ 5s
    for (let i = 0; i < maxRounds; i++) {
      if (checkAbortRef.current) break;
      await new Promise((r) => setTimeout(r, 5000));
      if (checkAbortRef.current) break;

      if (jobId) {
        const job = await fetchJobStatus(jobId, projectId);
        if (!("error" in job)) {
          const status = String(job.status || "").toLowerCase();
          const prog = typeof job.progress === "number" ? job.progress : 0;
          setCheckLabel(
            status === "queued"
              ? "Queued — Colab/worker start hone ka wait…"
              : `Checking… ${Math.round(prog)}%`
          );
          if (status === "completed" || status === "failed" || status === "cancelled") {
            await load();
            setChecking(false);
            setCheckLabel(
              status === "completed"
                ? "Check complete — neeche product counts."
                : `Check ${status}${job.error_message ? `: ${job.error_message}` : ""}`
            );
            setTimeout(() => setCheckLabel(""), 5000);
            return;
          }
        }
      }

      await load();
      // Early exit if we already have labeled rows and no pending uploads
      const inv = await fetchDatasetInventory(projectId, datasetId);
      if (!("error" in inv) && inv.labeled_count > 0 && (inv.pending_count ?? 0) === 0) {
        setData(inv);
        setChecking(false);
        setCheckLabel("Check complete — neeche product counts.");
        setTimeout(() => setCheckLabel(""), 5000);
        return;
      }
    }

    setChecking(false);
    setCheckLabel(
      "Abhi results pending hain — thodi der baad Refresh dabao (Colab/worker chal raha ho)."
    );
  }

  async function startStockCheck(afterUploadCount: number) {
    if (modelIds.length === 0) {
      setError(
        "Is project mein koi model nahi. Models page pe model upload karo, phir yahan images dubara upload karo."
      );
      return;
    }

    setCheckLabel("Product count check start…");
    setChecking(true);

    // Prefer Colab launch (creates job + notebook) — stays on Stock check UX
    const colab = await openColabLaunch({
      projectId,
      datasetId,
      modelIds,
      confidence: 0.15,
      iou: 0.45,
      relabelAll: false,
    });

    let jobId: string | undefined;

    if (colab.ok) {
      jobId = colab.jobId;
      if (colab.prefillUrl) {
        try {
          await navigator.clipboard.writeText(colab.prefillUrl);
        } catch {
          /* ignore */
        }
      }
      // Open Colab so detection can run — user stays conceptually on Stock check
      window.open(colab.colabUrl, "_blank", "noopener,noreferrer");
      setCheckLabel(
        `${afterUploadCount} image(s) uploaded as test names. Colab khula — Run all, counts yahin dikhenge.`
      );
    } else {
      // Fallback: queue auto-label on worker
      const job = await startAutoLabel(projectId, modelIds, datasetId, {
        confidence: 0.15,
        iou: 0.45,
      });
      if ("error" in job) {
        setChecking(false);
        setError(colab.error || job.error);
        return;
      }
      jobId = "job_id" in job ? job.job_id : undefined;
      setCheckLabel("Check queued on worker…");
    }

    void waitForCheckResults(jobId);
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList?.length || !datasetId || uploading) return;
    const raw = Array.from(fileList).filter((f) => IMAGE_EXT.test(f.name));
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (raw.length === 0) {
      setError("Only image files (jpg, png, webp, …) are allowed.");
      return;
    }

    const existingNames =
      data?.deletable_image_ids && data.images
        ? [
            ...data.images.map((i) => i.file_name),
            // also count unlabeled names if API ever returns them in another field
          ]
        : data?.images.map((i) => i.file_name) ?? [];

    // Prefer counting from current inventory image_count for unique test_N
    let startIdx = nextTestImageIndex(existingNames);
    // Bump by total images already in scratch bucket if known
    if (data?.image_count && data.image_count > existingNames.length) {
      startIdx = Math.max(startIdx, data.image_count + 1);
    }

    const files = raw.map((f, i) => renameAsTestImage(f, startIdx + i));

    setUploading(true);
    setError(null);
    setUploadProgress(0);
    setUploadLabel(`Uploading test ${startIdx}…`);

    try {
      let done = 0;
      for (const file of files) {
        const label = displayTestName(file.name);
        setUploadLabel(`Uploading ${label} (${done + 1} / ${files.length})`);
        await uploadImages(projectId, datasetId, [file], {
          onProgress: (pct) => {
            setUploadProgress(
              Math.round(((done + pct / 100) / files.length) * 100)
            );
          },
        });
        done += 1;
        setUploadProgress(Math.round((done / files.length) * 100));
      }
      setUploadLabel(
        `Uploaded ${files.length} as ${displayTestName(files[0].name)}` +
          (files.length > 1
            ? ` … ${displayTestName(files[files.length - 1].name)}`
            : "")
      );
      setShowLabelResults(true);
      await load();
      await startStockCheck(files.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setTimeout(() => {
        setUploadLabel("");
        setUploadProgress(0);
      }, 4000);
    }
  }

  function handleDeleteOne(imageId: string) {
    if (!datasetId) return;
    if (!confirm("Delete this check image?")) return;

    setDeleting(true);
    setDeleteStatus(true, "Deleting check image…");
    setData((prev) =>
      prev
        ? {
            ...prev,
            images: prev.images.filter((i) => i.image_id !== imageId),
            labeled_count: Math.max(0, prev.labeled_count - 1),
            deletable_image_ids: (prev.deletable_image_ids ?? []).filter(
              (id) => id !== imageId
            ),
            image_count: Math.max(0, prev.image_count - 1),
          }
        : prev
    );

    void (async () => {
      try {
        const result = await deleteDatasetFiles(projectId, datasetId, [
          imageId,
        ]);
        if (result && "error" in result) {
          setError(result.error ?? "Delete failed");
          await load();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
        await load();
      } finally {
        setDeleting(false);
        setDeleteStatus(false);
      }
    })();
  }

  function handleDeleteAll() {
    if (!datasetId || !data) return;
    const ids = data.deletable_image_ids?.length
      ? data.deletable_image_ids
      : data.images.map((i) => i.image_id);
    if (!ids.length) return;
    if (
      !confirm(
        `Delete all ${ids.length} Stock check image(s)? (Training datasets stay untouched.)`
      )
    ) {
      return;
    }

    setDeleting(true);
    setDeleteStatus(true, `Deleting ${ids.length} check images in background…`);
    setData((prev) =>
      prev
        ? {
            ...prev,
            images: [],
            image_count: 0,
            labeled_count: 0,
            pending_count: 0,
            total_objects: 0,
            class_totals: {},
            class_names: [],
            deletable_image_ids: [],
          }
        : prev
    );

    void (async () => {
      try {
        const result = await deleteAllDatasetFiles(
          projectId,
          datasetId,
          ids
        );
        if (result && "error" in result) {
          setError(result.error ?? "Delete all failed");
          await load();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete all failed");
        await load();
      } finally {
        setDeleting(false);
        setDeleteStatus(false);
      }
    })();
  }

  const totals = data ? Object.entries(data.class_totals) : [];
  const deletableCount = data?.deletable_image_ids?.length ?? data?.image_count ?? 0;

  async function handleCsvDownload() {
    if (!csvFile || csvDownloading) return;
    setCsvDownloading(true);
    setError(null);
    setCsvProgress("Starting background download…");
    setCsvProgressPct(0);
    try {
      const { total, totalAvailable } = await startStockCsvDownloadJob(
        csvFile,
        csvColumn,
        { limit: downloadLimit }
      );
      setCsvProgress(
        `Background download started — ${total}` +
          (totalAvailable > total ? ` of ${totalAvailable}` : "") +
          ` images. Aap page leave / reload kar sakte ho; ZIP ready hone pe apne aap download ho jayega.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV download failed");
      setCsvProgress("");
      setCsvDownloading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Hero controls */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 shadow-sm">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700/80">
              Live stock check
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Upload → counts (test 1, test 2…)
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Result / fridge photos upload karo — auto naam{" "}
              <strong>test 1</strong>, <strong>test 2</strong>… Models se
              product counts isi page pe. Manual label / dataset assign nahi.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-800">
              CSV direct mode · nothing saved to DB
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void handleFilesSelected(e.target.files)}
            />
          </div>
        </div>

        {(uploading || uploadLabel) && (
          <div className="border-t border-slate-200/80 px-6 pb-5 pt-4">
            <div className="mb-1.5 flex justify-between text-xs text-slate-600">
              <span>{uploadLabel}</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
        {(checking || checkLabel) && (
          <div className="border-t border-emerald-100 bg-emerald-50/60 px-6 py-3 text-sm text-emerald-900">
            {checkLabel || "Checking product counts…"}
          </div>
        )}
      </section>

      {/* ShopData CSV → download Pre / Result images only (no save to project) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Download from ShopData CSV
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Pick your CSV, choose <strong>Pre Image</strong> or{" "}
              <strong>Result Image</strong>, set a limit, then download. Job
              chal raha rahega agar aap doosre page pe jao ya reload karo —
              ZIP ready hone pe browser download khud start hoga. Project pe
              kuch save nahi hota.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-[180px] flex-1 text-sm">
            <span className="mb-1 block text-slate-600">CSV file</span>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm"
              disabled={csvDownloading}
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <fieldset className="min-w-[220px]">
            <legend className="mb-1 text-sm text-slate-600">Column</legend>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={csvDownloading}
                onClick={() => setCsvColumn("pre")}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  csvColumn === "pre"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Pre Image
              </button>
              <button
                type="button"
                disabled={csvDownloading}
                onClick={() => setCsvColumn("result")}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  csvColumn === "result"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Result Image
              </button>
            </div>
          </fieldset>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Shared image limit</span>
            <input
              type="number"
              min={1}
              max={500}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={downloadLimit}
              disabled={csvDownloading}
              onChange={(e) => setDownloadLimit(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <span className="mt-1 block text-xs text-slate-400">Same limit for detection, ZIP and Similar check</span>
          <Button
            type="button"
            loading={csvDownloading}
            disabled={!csvFile || csvDownloading || uploading}
            onClick={() => void handleCsvDownload()}
          >
            {!csvDownloading && <Download className="h-4 w-4" />}
            Download ZIP
          </Button>
        </div>

        {csvFile && (
          <p className="mt-2 text-xs text-slate-500">
            Selected: {csvFile.name}
            {csvColumn === "result"
              ? " → Result Image"
              : " → Pre Image"}
            {downloadLimit > 0
              ? ` · max ${downloadLimit}`
              : " · no limit"}
          </p>
        )}

        {(csvDownloading || csvProgress) && (
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-xs text-slate-600">
              <span>{csvProgress}</span>
              {csvDownloading && <span>{csvProgressPct}%</span>}
            </div>
            {csvDownloading && (
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${csvProgressPct}%` }}
                />
              </div>
            )}
          </div>
        )}

        <StockCsvDetectionPanel
          projectId={projectId}
          modelIds={modelIds}
          csvFile={csvFile}
          limit={downloadLimit}
          disabled={csvDownloading || uploading}
        />

        <StockSimilarComparePanel
          csvFile={csvFile}
          limit={downloadLimit}
          disabled={csvDownloading || uploading}
        />
      </section>

      {error && <Alert variant="error">{error}</Alert>}

      {modelIds.length === 0 && (
        <Alert variant="info">
          Is project mein model nahi — Models pe pehle model upload karo, phir
          yahan images check ho sakengi.
        </Alert>
      )}

      {false && (data?.pending_count ?? 0) > 0 && !checking && (
        <Alert variant="info">
          {data?.pending_count} photo(s) abhi counts ka wait kar rahi hain.
          Colab/worker complete hone ke baad Refresh dabao.
        </Alert>
      )}

      {false && showLabelResults && totals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {totals.map(([name, count]) => (
            <span
              key={name}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm shadow-sm"
            >
              <span className="text-slate-700">{name}</span>
              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white">
                {count}
              </span>
            </span>
          ))}
        </div>
      )}

      {false && loading && !data && (
        <p className="text-sm text-slate-500">Loading stock check…</p>
      )}

      {false && !loading && data && labeled.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-base font-medium text-slate-800">
            Abhi koi check nahi
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Result / fridge images upload karo — naam auto{" "}
            <strong>test 1</strong>, <strong>test 2</strong>… Models counts
            yahin dikhayenge (manual label nahi).
          </p>
        </div>
      )}

      {false && showLabelResults && labeled.length > 0 && (
        <div className="space-y-5">
          {labeled.map((img, idx) => {
            const thumbUrl = imageContentUrl(projectId, img.image_id);
            const counts = Object.entries(img.class_counts);
            const title = displayTestName(img.file_name);
            return (
              <article
                key={img.image_id}
                className="group overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                style={{
                  animationDelay: `${Math.min(idx, 8) * 40}ms`,
                }}
              >
                <div className="flex flex-col sm:flex-row">
                  <div className="flex w-full shrink-0 items-center justify-center bg-slate-100 p-2 sm:w-[42%] md:w-[40%]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbUrl}
                      alt={title}
                      className="max-h-[70vh] w-full object-contain"
                      loading="lazy"
                    />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 p-5 sm:p-6">
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-slate-900">
                            {title}
                          </p>
                          <p className="mt-0.5 text-sm text-slate-500">
                            {img.total_objects} product
                            {img.total_objects === 1 ? "" : "s"} found
                          </p>
                        </div>
                        <button
                          type="button"
                          title="Delete"
                          disabled={deleting || uploading}
                          onClick={() => handleDeleteOne(img.image_id)}
                          className="rounded-lg p-2 text-slate-400 opacity-70 transition hover:bg-red-50 hover:text-red-600 hover:opacity-100 disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <ul className="mt-4 space-y-2.5">
                        {counts.map(([name, count]) => (
                          <li
                            key={`${img.image_id}-${name}`}
                            className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3.5 py-2.5"
                          >
                            <span className="text-sm font-medium text-slate-800">
                              {name}
                            </span>
                            <span className="min-w-[2rem] rounded-lg bg-slate-900 px-2.5 py-1 text-center text-sm font-bold tabular-nums text-white">
                              {count}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
