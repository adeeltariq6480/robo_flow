"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createDataset, deleteDataset } from "@/lib/actions/datasets";
import type { Dataset } from "@/lib/types/database";
import { formatBytes } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Database, Plus, Upload, Trash2, X, Check } from "lucide-react";

interface DatasetsPageClientProps {
  projectId: string;
  datasets: Dataset[];
}

export function DatasetsPageClient({ projectId, datasets }: DatasetsPageClientProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await createDataset(projectId, formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  async function handleDelete(datasetId: string) {
    if (!confirm("Delete this dataset and all its files?")) return;
    setLoading(true);
    const result = await deleteDataset(projectId, datasetId);
    if (result?.error) setError(result.error);
    else router.refresh();
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="Datasets"
          description="Upload and organize training data for your project."
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
              <Button type="submit" disabled={loading}>
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

        {datasets.length === 0 ? (
          <p className="text-sm text-slate-500">
            No datasets yet. Create one to start uploading files.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {datasets.map((dataset) => (
              <li
                key={dataset.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div className="flex items-center gap-3">
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
                <div className="flex gap-2">
                  <Link
                    href={`/projects/${projectId}/datasets/${dataset.id}/upload`}
                  >
                    <Button variant="secondary">
                      <Upload className="h-4 w-4" />
                      Upload
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={() => handleDelete(dataset.id)}
                    disabled={loading}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
