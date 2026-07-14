"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  bulkSetReviewStatus,
  setReviewStatus,
} from "@/lib/actions/annotations";
import {
  deleteDatasetFiles,
  deleteAllDatasetFiles,
} from "@/lib/actions/datasets";
import { imageContentUrl } from "@/lib/api/client";
import type {
  DatasetFileReview,
  ReviewFilter,
} from "@/lib/types/annotations";
import { REVIEW_FILTER_LABELS } from "@/lib/types/annotations";
import type { Class } from "@/lib/types/database";
import {
  ALL_CLASS_ID,
  fileMatchesClassFilter,
} from "@/lib/classes/constants";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ClassSelect } from "@/components/ui/class-select";
import { BulkDeleteToolbar } from "@/components/ui/bulk-delete-toolbar";
import {
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  X,
  XCircle,
} from "lucide-react";
import { ClassCountChips } from "@/components/annotations/class-count-chips";

interface AnnotationReviewQueueProps {
  projectId: string;
  datasetId: string;
  datasetName: string;
  classes: Class[];
  files: DatasetFileReview[];
  counts: Record<ReviewFilter, number>;
  activeFilter: ReviewFilter;
}

function statusBadge(file: DatasetFileReview) {
  if (file.review_status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    );
  }
  if (file.review_status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        <XCircle className="h-3 w-3" />
        Rejected
      </span>
    );
  }
  if (file.review_status === "pending" || file.auto_labeled_at) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        <Clock className="h-3 w-3" />
        Needs review
      </span>
    );
  }
  if (file.annotations.length > 0) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
        Annotated
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
      Unannotated
    </span>
  );
}

const FILTERS: ReviewFilter[] = [
  "all",
  "needs_review",
  "unannotated",
  "annotated",
  "approved",
  "rejected",
];

export function AnnotationReviewQueue({
  projectId,
  datasetId,
  datasetName,
  classes,
  files,
  counts,
  activeFilter,
}: AnnotationReviewQueueProps) {
  const router = useRouter();
  const base = `/projects/${projectId}/datasets/${datasetId}/review`;
  const filterQuery =
    activeFilter !== "all" ? `?filter=${activeFilter}` : "";
  const [classFilter, setClassFilter] = useState(ALL_CLASS_ID);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleFiles = useMemo(
    () =>
      files.filter((file) =>
        fileMatchesClassFilter(
          { annotations: file.annotations, class_id: null },
          classFilter,
          classes
        )
      ),
    [files, classFilter, classes]
  );

  const allSelected =
    visibleFiles.length > 0 && selected.size === visibleFiles.length;
  const selectionActive = selected.size > 0;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(visibleFiles.map((f) => f.id)));
  }

  function setFilter(filter: ReviewFilter) {
    const q = filter === "all" ? "" : `?filter=${filter}`;
    router.push(`${base}${q}`);
    setSelected(new Set());
  }

  function openReview(fileId: string) {
    router.push(`${base}/${fileId}${filterQuery}`);
  }

  async function handleReviewAction(
    fileId: string,
    status: "approved" | "rejected"
  ) {
    setLoading(true);
    setError(null);
    const result = await setReviewStatus(
      projectId,
      datasetId,
      fileId,
      status
    );
    if (result && "error" in result) setError(result.error ?? "Request failed");
    else {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      router.refresh();
    }
    setLoading(false);
  }

  async function handleBulkReview(status: "approved" | "rejected") {
    if (selected.size === 0) return;
    const label = status === "approved" ? "approve" : "reject";
    if (!confirm(`${label} ${selected.size} selected image(s)?`)) return;
    setLoading(true);
    setLoadingLabel(
      `${status === "approved" ? "Approving" : "Rejecting"} ${selected.size} images…`
    );
    setError(null);
    const result = await bulkSetReviewStatus(
      projectId,
      datasetId,
      Array.from(selected),
      status
    );
    if (result && "error" in result) setError(result.error ?? "Request failed");
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoadingLabel(null);
    setLoading(false);
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected file(s)?`)) return;
    setLoading(true);
    setError(null);
    const result = await deleteDatasetFiles(
      projectId,
      datasetId,
      Array.from(selected)
    );
    if (result && "error" in result) setError(result.error ?? "Request failed");
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoading(false);
  }

  async function handleDeleteAll() {
    if (visibleFiles.length === 0) return;
    if (!confirm(`Delete all ${visibleFiles.length} visible file(s)?`)) return;
    setLoading(true);
    setError(null);
    const result = await deleteAllDatasetFiles(
      projectId,
      datasetId,
      visibleFiles.map((f) => f.id)
    );
    if (result && "error" in result) setError(result.error ?? "Request failed");
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="relative pb-20">
      {loadingLabel && (
        <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
          {loadingLabel}
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Card className="flex max-h-[calc(100dvh-11rem)] min-h-[28rem] flex-col overflow-hidden !p-0">
        <div className="shrink-0 space-y-4 border-b border-slate-100 px-6 pb-4 pt-6">
          <CardHeader
            title="Annotation review"
            description={`Open each image to edit boxes, or select images to approve / reject in bulk.`}
            className="mb-0"
          />

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 shrink-0 text-slate-400" />
              {FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setFilter(filter)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    activeFilter === filter
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {REVIEW_FILTER_LABELS[filter]}
                  <span className="ml-1 opacity-70">({counts[filter] ?? 0})</span>
                </button>
              ))}
            </div>

            {classes.length > 0 && (
              <ClassSelect
                label="Class"
                classes={classes}
                value={classFilter}
                onChange={(value) => {
                  setClassFilter(value);
                  setSelected(new Set());
                }}
                className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            )}
          </div>

          <BulkDeleteToolbar
            itemLabel="images"
            totalCount={visibleFiles.length}
            selectedCount={selected.size}
            onDeleteSelected={handleDeleteSelected}
            onDeleteAll={handleDeleteAll}
            disabled={loading}
            loading={loading}
            allSelected={allSelected}
            onToggleSelectAll={toggleSelectAll}
            className="mb-0"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {visibleFiles.length === 0 ? (
            <p className="text-sm text-slate-500">
              No images match this filter. Upload images or run auto-label from
              Inference, then use <strong>Needs review</strong> to see labeled
              files.
            </p>
          ) : (
            <div className="space-y-4">
              {visibleFiles.map((file) => {
                const isSelected = selected.has(file.id);
                const thumbUrl = imageContentUrl(projectId, file.id);
                const reviewHref = `${base}/${file.id}${filterQuery}`;
                const hasLabels = file.annotations.length > 0;

                return (
                  <article
                    key={file.id}
                    className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition ${
                      isSelected
                        ? "border-emerald-400 ring-2 ring-emerald-100"
                        : "border-slate-200/90 hover:border-emerald-200 hover:shadow-md"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row">
                      <div className="relative h-44 w-full shrink-0 overflow-hidden bg-slate-100 sm:h-auto sm:min-h-[168px] sm:w-[36%] md:w-[32%]">
                        <button
                          type="button"
                          onClick={() => openReview(file.id)}
                          className="group block h-full w-full text-left"
                          title="Open image to review"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumbUrl}
                            alt=""
                            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02] sm:absolute sm:inset-0 sm:h-full"
                            loading="lazy"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
                            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow">
                              <ExternalLink className="h-3.5 w-3.5" />
                              Open
                            </span>
                          </span>
                        </button>
                        <label className="absolute left-2.5 top-2.5 flex cursor-pointer items-center rounded-lg bg-white/95 p-1.5 shadow-sm">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(file.id)}
                            disabled={loading}
                            className="rounded border-slate-300"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </label>
                        <div className="absolute right-2.5 top-2.5">
                          {statusBadge(file)}
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 p-4 sm:p-5">
                        <div>
                          {hasLabels ? (
                            <>
                              <p className="text-sm font-semibold text-slate-900">
                                {file.annotations.length}{" "}
                                <span className="font-normal text-slate-500">
                                  label{file.annotations.length === 1 ? "" : "s"}
                                </span>
                              </p>
                              <div className="mt-3">
                                <ClassCountChips boxes={file.annotations} />
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-slate-400">No labels yet</p>
                          )}
                        </div>

                        {isSelected ? (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              className="flex-1 !border-green-300 !py-1.5 !text-xs !text-green-700 hover:!bg-green-50"
                              onClick={() =>
                                handleReviewAction(file.id, "approved")
                              }
                              disabled={loading}
                              loading={loading}
                            >
                              {!loading && <Check className="h-3.5 w-3.5" />}
                              Approve
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              className="flex-1 !border-red-300 !py-1.5 !text-xs !text-red-700 hover:!bg-red-50"
                              onClick={() =>
                                handleReviewAction(file.id, "rejected")
                              }
                              disabled={loading}
                              loading={loading}
                            >
                              {!loading && <X className="h-3.5 w-3.5" />}
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <Link href={reviewHref} className="block sm:self-start">
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-full !py-1.5 !text-xs sm:w-auto"
                            >
                              Review image
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {selectionActive && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={() => handleBulkReview("approved")}
            disabled={loading}
            loading={loading}
            className="shadow-lg !bg-green-600 hover:!bg-green-700"
          >
            {!loading && <Check className="h-4 w-4" />}
            Approve all ({selected.size})
          </Button>
          <Button
            type="button"
            onClick={() => handleBulkReview("rejected")}
            disabled={loading}
            loading={loading}
            className="shadow-lg !bg-red-600 hover:!bg-red-700"
          >
            {!loading && <X className="h-4 w-4" />}
            Reject all ({selected.size})
          </Button>
        </div>
      )}
    </div>
  );
}
