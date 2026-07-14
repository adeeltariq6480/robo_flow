"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fetchDatasetInventory } from "@/lib/actions/inventory";
import {
  deleteAllDatasetFiles,
  deleteDatasetFiles,
} from "@/lib/actions/datasets";
import { uploadImages } from "@/lib/api/uploads";
import { imageContentUrl } from "@/lib/api/client";
import { setDeleteStatus } from "@/lib/delete-status";
import type { DatasetInventory } from "@/lib/worker/client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { RefreshCw, Trash2, Upload } from "lucide-react";

interface InventoryPanelProps {
  projectId: string;
  /** Hidden Stock check scratch dataset id — not shown in Datasets. */
  stockCheckDatasetId: string;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

export function InventoryPanel({
  projectId,
  stockCheckDatasetId,
}: InventoryPanelProps) {
  const datasetId = stockCheckDatasetId;
  const [data, setData] = useState<DatasetInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, datasetId]);

  const labeled = useMemo(() => data?.images ?? [], [data]);

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList?.length || !datasetId || uploading) return;
    const files = Array.from(fileList).filter((f) => IMAGE_EXT.test(f.name));
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) {
      setError("Only image files (jpg, png, webp, …) are allowed.");
      return;
    }

    setUploading(true);
    setError(null);
    setUploadProgress(0);
    setUploadLabel(`Uploading 0 / ${files.length}…`);

    try {
      let done = 0;
      for (const file of files) {
        setUploadLabel(`Uploading ${done + 1} / ${files.length}`);
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
        `Uploaded ${files.length}. Run auto-label (Inference) to see counts.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setTimeout(() => {
        setUploadLabel("");
        setUploadProgress(0);
      }, 3500);
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
              Photo → product counts
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Upload check photos here — they stay off your training datasets.
              After labeling, only real detections show (Pepsi, 7up, …).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              loading={loading}
              onClick={() => void load()}
              disabled={loading || uploading}
            >
              {!loading && <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button
              type="button"
              loading={uploading}
              disabled={uploading || deleting}
              onClick={() => fileInputRef.current?.click()}
            >
              {!uploading && <Upload className="h-4 w-4" />}
              Upload images
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDeleteAll}
              disabled={deleting || uploading || deletableCount === 0}
            >
              <Trash2 className="h-4 w-4" />
              Delete all
            </Button>
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
          <div className="border-t border-slate-200/80 px-6 pb-5">
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
      </section>

      {error && <Alert variant="error">{error}</Alert>}

      {data && (data.pending_count ?? 0) > 0 && (
        <Alert variant="info">
          {data.pending_count} uploaded photo(s) waiting for labels. Run{" "}
          <Link
            href={`/projects/${projectId}/inference`}
            className="font-medium underline underline-offset-2"
          >
            Inference → auto-label
          </Link>{" "}
          on the stock-check images, then Refresh.
        </Alert>
      )}

      {totals.length > 0 && (
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

      {loading && !data && (
        <p className="text-sm text-slate-500">Loading stock check…</p>
      )}

      {!loading && data && labeled.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-base font-medium text-slate-800">
            No labeled checks yet
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Upload fridge photos, auto-label them, then each row shows only the
            products found — short and clear.
          </p>
        </div>
      )}

      {labeled.length > 0 && (
        <div className="space-y-5">
          {labeled.map((img, idx) => {
            const thumbUrl = imageContentUrl(projectId, img.image_id);
            const counts = Object.entries(img.class_counts);
            return (
              <article
                key={img.image_id}
                className="group overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                style={{
                  animationDelay: `${Math.min(idx, 8) * 40}ms`,
                }}
              >
                <div className="flex flex-col sm:flex-row">
                  <div className="relative h-52 w-full shrink-0 overflow-hidden bg-slate-100 sm:h-auto sm:min-h-[200px] sm:w-[42%] md:w-[38%]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbUrl}
                      alt=""
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02] sm:absolute sm:inset-0"
                      loading="lazy"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/25 to-transparent sm:bg-gradient-to-r sm:from-transparent sm:to-transparent" />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 p-5 sm:p-6">
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {img.total_objects}{" "}
                          <span className="font-normal text-slate-500">
                            product{img.total_objects === 1 ? "" : "s"} found
                          </span>
                        </p>
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
