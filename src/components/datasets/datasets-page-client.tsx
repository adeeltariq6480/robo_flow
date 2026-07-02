"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createDataset,
  deleteDataset,
  deleteDatasets,
  deleteAllDatasets,
} from "@/lib/actions/datasets";
import type { Dataset } from "@/lib/types/database";
import { formatBytes } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import { BulkDeleteToolbar } from "@/components/ui/bulk-delete-toolbar";
import { Database, Plus, Upload, Trash2, X, Check, ClipboardCheck, Download, Tags } from "lucide-react";

interface DatasetsPageClientProps {
  projectId: string;
  datasets: Dataset[];
  hasModels: boolean;
}

export function DatasetsPageClient({ projectId, datasets, hasModels }: DatasetsPageClientProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = datasets.length > 0 && selected.size === datasets.length;

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
    else setSelected(new Set(datasets.map((d) => d.id)));
  }

  async function handleCreate(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await createDataset(projectId, formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected dataset(s) and all their files?`)) return;
    setLoading(true);
    const result = await deleteDatasets(projectId, Array.from(selected));
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoading(false);
  }

  async function handleDeleteAll() {
    if (!confirm("Delete ALL datasets in this project?")) return;
    setLoading(true);
    const result = await deleteAllDatasets(projectId);
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoading(false);
  }

  async function handleDeleteOne(datasetId: string) {
    if (!confirm("Delete this dataset and all its files?")) return;
    setLoading(true);
    const result = await deleteDataset(projectId, datasetId);
    if (result?.error) setError(result.error);
    else {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(datasetId);
        return next;
      });
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="Datasets"
          description="Upload images, then Label all to auto-annotate every image with your YOLO model."
          action={
            !showForm && (
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4" />
                New dataset
              </Button>
            )
          }
        />

        {showForm && (
          <form
            action={handleCreate}
            className="mb-6 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <Input
              label="Dataset name"
              name="name"
              placeholder="e.g. training-set-v1"
              required
              autoFocus
            />
            <Textarea
              label="Description (optional)"
              name="description"
              rows={2}
              placeholder="What does this dataset contain?"
            />
            <div className="flex gap-2">
              <Button type="submit" loading={loading}>
                <Check className="h-4 w-4" />
                Create & upload
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowForm(false)}
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          </form>
        )}

        {hasModels && datasets.length > 0 && (
          <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
            <strong>Label images:</strong> Har dataset ke saath{" "}
            <strong>Label all</strong> dabayein — model saari images par boxes
            laga dega. Phir <strong>Review</strong> se approve karein.
          </div>
        )}

        <BulkDeleteToolbar
          itemLabel="datasets"
          totalCount={datasets.length}
          selectedCount={selected.size}
          onDeleteSelected={handleDeleteSelected}
          onDeleteAll={handleDeleteAll}
          disabled={loading}
          loading={loading}
          allSelected={allSelected}
          onToggleSelectAll={toggleSelectAll}
        />

        {datasets.length === 0 ? (
          <p className="text-sm text-slate-500">
            No datasets yet. Create one to start uploading files.
          </p>
        ) : (
          <div className="max-h-[80vh] overflow-y-auto">
            <ul className="divide-y divide-slate-100">
            {datasets.map((dataset) => (
              <li
                key={dataset.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(dataset.id)}
                    onChange={() => toggleSelect(dataset.id)}
                    disabled={loading}
                    className="rounded border-slate-300"
                  />
                  <div className="rounded-lg bg-green-50 p-2">
                    <Database className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{dataset.name}</p>
                    <p className="text-sm text-slate-500">
                      {dataset.file_count} file{dataset.file_count !== 1 ? "s" : ""} ·{" "}
                      {formatBytes(dataset.total_size_bytes)}
                    </p>
                    {dataset.description && (
                      <p className="mt-0.5 text-sm text-slate-400">
                        {dataset.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {hasModels && dataset.file_count > 0 ? (
                    <LinkButton
                      href={`/projects/${projectId}/datasets/${dataset.id}/label`}
                    >
                      <Tags className="h-4 w-4" />
                      Label all
                    </LinkButton>
                  ) : (
                    <LinkButton
                      href={`/projects/${projectId}/models/upload`}
                      variant="secondary"
                      title="Upload a model first"
                    >
                      <Tags className="h-4 w-4" />
                      Label all
                    </LinkButton>
                  )}
                  <LinkButton
                    href={`/projects/${projectId}/datasets/${dataset.id}/export`}
                    variant="secondary"
                  >
                    <Download className="h-4 w-4" />
                    Export
                  </LinkButton>
                  <LinkButton
                    href={`/projects/${projectId}/datasets/${dataset.id}/review`}
                    variant="secondary"
                  >
                    <ClipboardCheck className="h-4 w-4" />
                    Review
                  </LinkButton>
                  <LinkButton
                    href={`/projects/${projectId}/datasets/${dataset.id}/upload`}
                    variant="secondary"
                  >
                    <Upload className="h-4 w-4" />
                    Upload
                  </LinkButton>
                  <Button
                    variant="ghost"
                    onClick={() => handleDeleteOne(dataset.id)}
                    loading={loading}
                    className="text-red-600 hover:bg-red-50"
                  >
                    {!loading && <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              </li>
            ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
