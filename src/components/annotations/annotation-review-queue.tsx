"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteDatasetFiles,
  deleteAllDatasetFiles,
} from "@/lib/actions/datasets";
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
  CheckCircle2,
  Clock,
  FileImage,
  Filter,
  Pencil,
  XCircle,
} from "lucide-react";

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
  const [classFilter, setClassFilter] = useState(ALL_CLASS_ID);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
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
    if (result?.error) setError(result.error);
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
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Card>
        <CardHeader
          title="Annotation review"
          description={`Review and edit bounding boxes for ${datasetName}.`}
        />

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
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
          itemLabel="files"
          totalCount={visibleFiles.length}
          selectedCount={selected.size}
          onDeleteSelected={handleDeleteSelected}
          onDeleteAll={handleDeleteAll}
          disabled={loading}
          allSelected={allSelected}
          onToggleSelectAll={toggleSelectAll}
        />

        {visibleFiles.length === 0 ? (
          <p className="text-sm text-slate-500">
            No files match this filter. Upload images or run auto-label from
            Inference.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visibleFiles.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(file.id)}
                    onChange={() => toggleSelect(file.id)}
                    disabled={loading}
                    className="rounded border-slate-300"
                  />
                  <div className="rounded-lg bg-slate-100 p-2">
                    <FileImage className="h-5 w-5 text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      {file.file_name}
                    </p>
                    <p className="text-sm text-slate-500">
                      {file.annotations.length} box
                      {file.annotations.length !== 1 ? "es" : ""}
                      {file.auto_labeled_at && " · auto-labeled"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {statusBadge(file)}
                  <Link href={`${base}/${file.id}?filter=${activeFilter}`}>
                    <Button variant="secondary">
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
