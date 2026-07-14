"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchDatasetInventory } from "@/lib/actions/inventory";
import {
  deleteAllDatasetFiles,
  deleteDatasetFiles,
} from "@/lib/actions/datasets";
import { uploadImages } from "@/lib/api/uploads";
import { imageContentUrl } from "@/lib/api/client";
import { setDeleteStatus } from "@/lib/delete-status";
import type { DatasetInventory } from "@/lib/worker/client";
import type { Dataset } from "@/lib/types/database";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  ClipboardList,
  RefreshCw,
  Trash2,
  Upload,
  ImageIcon,
} from "lucide-react";

interface InventoryPanelProps {
  projectId: string;
  datasets: Dataset[];
  defaultDatasetId?: string;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

export function InventoryPanel({
  projectId,
  datasets,
  defaultDatasetId,
}: InventoryPanelProps) {
  const initial =
    defaultDatasetId && datasets.some((d) => d.id === defaultDatasetId)
      ? defaultDatasetId
      : datasets[0]?.id ?? "";
  const [datasetId, setDatasetId] = useState(initial);
  const [data, setData] = useState<DatasetInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load(id: string) {
    if (!id) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await fetchDatasetInventory(projectId, id);
    if ("error" in result) {
      setError(result.error);
      setData(null);
    } else {
      setData(result);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load(datasetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, datasetId]);

  const classNames = useMemo(() => {
    if (data?.class_names?.length) return data.class_names;
    if (!data) return [];
    return Object.keys(data.class_totals);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.images;
    return data.images.filter((img) => {
      if (img.file_name.toLowerCase().includes(q)) return true;
      return Object.keys(img.class_counts).some((name) =>
        name.toLowerCase().includes(q)
      );
    });
  }, [data, query]);

  const datasetName =
    datasets.find((d) => d.id === datasetId)?.name ?? "dataset";

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
      // One file at a time so each image lands immediately without multi-select choreography
      let done = 0;
      for (const file of files) {
        setUploadLabel(`Uploading ${done + 1} / ${files.length}: ${file.name}`);
        await uploadImages(projectId, datasetId, [file], {
          onProgress: (pct) => {
            const overall = Math.round(
              ((done + pct / 100) / files.length) * 100
            );
            setUploadProgress(overall);
          },
        });
        done += 1;
        setUploadProgress(Math.round((done / files.length) * 100));
      }
      setUploadLabel(`Uploaded ${files.length} image(s)`);
      await load(datasetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setTimeout(() => {
        setUploadLabel("");
        setUploadProgress(0);
      }, 2000);
    }
  }

  function handleDeleteOne(imageId: string, fileName: string) {
    if (!datasetId) return;
    if (!confirm(`Delete "${fileName}"?`)) return;

    setDeleting(true);
    setDeleteStatus(true, `Deleting ${fileName}…`);
    setData((prev) =>
      prev
        ? {
            ...prev,
            images: prev.images.filter((i) => i.image_id !== imageId),
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
          await load(datasetId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
        await load(datasetId);
      } finally {
        setDeleting(false);
        setDeleteStatus(false);
      }
    })();
  }

  function handleDeleteAll() {
    if (!datasetId || !data?.images.length) return;
    const ids = data.images.map((i) => i.image_id);
    if (
      !confirm(
        `Delete ALL ${ids.length} image(s) in "${datasetName}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setDeleting(true);
    setDeleteStatus(
      true,
      `Deleting all ${ids.length} images in background…`
    );
    // Clear UI immediately; delete keeps running even if you leave this page
    setData((prev) =>
      prev
        ? {
            ...prev,
            images: [],
            image_count: 0,
            labeled_count: 0,
            total_objects: 0,
            class_totals: {},
            class_names: [],
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
          await load(datasetId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete all failed");
        await load(datasetId);
      } finally {
        setDeleting(false);
        setDeleteStatus(false);
      }
    })();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Stock check"
          description="Upload fridge/shelf photos, see per-image product counts (Pepsi, 7up, …), delete one or all."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                loading={loading}
                onClick={() => void load(datasetId)}
                disabled={!datasetId || loading || uploading}
              >
                {!loading && <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleDeleteAll}
                disabled={
                  !datasetId ||
                  deleting ||
                  uploading ||
                  !data?.images.length
                }
              >
                <Trash2 className="h-4 w-4" />
                Delete all
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-end gap-4">
          <label className="block min-w-[220px] flex-1 text-sm">
            <span className="mb-1 block text-slate-600">Dataset</span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              disabled={datasets.length === 0 || uploading}
            >
              {datasets.length === 0 && <option value="">No datasets</option>}
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[200px] flex-1 text-sm">
            <span className="mb-1 block text-slate-600">Search image / class</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="e.g. pepsi 250 or IMG_01"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Upload images</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Pick files — each image uploads one-by-one. No checklist needed.
              </p>
            </div>
            <Button
              type="button"
              loading={uploading}
              disabled={!datasetId || uploading || deleting}
              onClick={() => fileInputRef.current?.click()}
            >
              {!uploading && <Upload className="h-4 w-4" />}
              Choose images
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
          {(uploading || uploadLabel) && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-slate-600">
                <span>{uploadLabel}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-slate-900 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {!error && !loading && data && data.image_count === 0 && (
          <div className="mt-4">
            <Alert variant="info">
              No images in <strong>{datasetName}</strong> yet. Upload above, or
              wait until auto-label finishes then refresh for product counts.
            </Alert>
          </div>
        )}
      </Card>

      {data && data.image_count > 0 && (
        <>
          <Card>
            <CardHeader
              title="Dataset totals"
              description={`${data.image_count} image(s) · ${data.labeled_count} labeled · ${data.total_objects} objects`}
            />
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.class_totals).map(([name, count]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-800"
                >
                  <span className="font-medium">{name}</span>
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white">
                    {count}
                  </span>
                </span>
              ))}
              {Object.keys(data.class_totals).length === 0 && (
                <p className="text-sm text-slate-500">
                  Images uploaded — product counts appear after labeling.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Images"
              description={`${filtered.length} of ${data.image_count} — left photo, right product counts`}
            />
            <div className="space-y-4">
              {filtered.map((img) => {
                const thumbUrl = imageContentUrl(projectId, img.image_id);
                const counts =
                  Object.keys(img.class_counts).length > 0
                    ? Object.entries(img.class_counts)
                    : classNames.map((n) => [n, 0] as [string, number]);
                return (
                  <div
                    key={img.image_id}
                    className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white sm:flex-row"
                  >
                    {/* Left: photo only (no file name) */}
                    <div className="relative h-48 w-full shrink-0 overflow-hidden bg-slate-100 sm:min-h-[180px] sm:w-56 md:w-72">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrl}
                        alt=""
                        className="h-full w-full object-cover sm:absolute sm:inset-0"
                        loading="lazy"
                      />
                    </div>

                    {/* Right: product summary */}
                    <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          Total: {img.total_objects}
                        </p>
                        <button
                          type="button"
                          title="Delete image"
                          disabled={deleting || uploading}
                          onClick={() =>
                            handleDeleteOne(img.image_id, img.file_name)
                          }
                          className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {counts.length === 0 ? (
                        <p className="flex items-center gap-1.5 text-sm text-slate-400">
                          <ImageIcon className="h-4 w-4" />
                          No labels yet — run auto-label / review
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {counts.map(([name, count]) => (
                            <li
                              key={`${img.image_id}-${name}`}
                              className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 text-sm last:border-0 last:pb-0"
                            >
                              <span className="text-slate-700">{name}</span>
                              <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                                {count}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {loading && !data && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <ClipboardList className="h-4 w-4" />
            Loading inventory…
          </div>
        </Card>
      )}
    </div>
  );
}
