"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteModel,
  deleteModels,
  deleteAllModels,
} from "@/lib/actions/models";
import type { Model } from "@/lib/types/database";
import { formatBytes } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import { BulkDeleteToolbar } from "@/components/ui/bulk-delete-toolbar";
import { Box, Plus, Upload, Trash2 } from "lucide-react";

const FORMAT_LABELS: Record<string, string> = {
  onnx: "ONNX",
  pytorch: "PyTorch",
  tensorflow: "TensorFlow",
  tflite: "TFLite",
  other: "Other",
};

interface ModelsPageClientProps {
  projectId: string;
  models: Model[];
}

export function ModelsPageClient({ projectId, models }: ModelsPageClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = models.length > 0 && selected.size === models.length;

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
    else setSelected(new Set(models.map((m) => m.id)));
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected model(s)?`)) return;
    setLoading(true);
    const result = await deleteModels(projectId, Array.from(selected));
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoading(false);
  }

  async function handleDeleteAll() {
    if (!confirm("Delete ALL models in this project?")) return;
    setLoading(true);
    const result = await deleteAllModels(projectId);
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoading(false);
  }

  async function handleDeleteOne(modelId: string) {
    if (!confirm("Delete this model?")) return;
    setLoading(true);
    setDeletingId(modelId);
    const result = await deleteModel(projectId, modelId);
    if (result?.error) setError(result.error);
    else {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
      router.refresh();
    }
    setDeletingId(null);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="Models"
          description="Uploaded model artifacts for inference and deployment."
          action={
            <LinkButton href={`/projects/${projectId}/models/upload`}>
              <Plus className="h-4 w-4" />
              Upload model
            </LinkButton>
          }
        />

        <BulkDeleteToolbar
          itemLabel="models"
          totalCount={models.length}
          selectedCount={selected.size}
          onDeleteSelected={handleDeleteSelected}
          onDeleteAll={handleDeleteAll}
          disabled={loading}
          loading={loading}
          allSelected={allSelected}
          onToggleSelectAll={toggleSelectAll}
        />

        {models.length === 0 ? (
          <div className="py-8 text-center">
            <Box className="mx-auto h-12 w-12 text-slate-300" />
            <p className="mt-4 text-sm text-slate-500">
              No models uploaded yet.
            </p>
            <LinkButton
              href={`/projects/${projectId}/models/upload`}
              variant="secondary"
              className="mt-4"
            >
              <Upload className="h-4 w-4" />
              Upload your first model
            </LinkButton>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {models.map((model) => (
              <li
                key={model.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(model.id)}
                    onChange={() => toggleSelect(model.id)}
                    disabled={loading}
                    className="rounded border-slate-300"
                  />
                  <div className="rounded-lg bg-amber-50 p-2">
                    <Box className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">
                      {model.name}{" "}
                      <span className="text-sm font-normal text-slate-400">
                        v{model.version}
                      </span>
                    </p>
                    <p className="text-sm text-slate-500">
                      {FORMAT_LABELS[model.format] ?? model.format ?? "Other"} ·{" "}
                      {formatBytes(model.file_size)}
                    </p>
                    {model.description && (
                      <p className="mt-0.5 text-sm text-slate-400">
                        {model.description}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => handleDeleteOne(model.id)}
                  loading={deletingId === model.id}
                  disabled={loading && deletingId !== model.id}
                  className="text-red-600 hover:bg-red-50"
                >
                  {deletingId !== model.id && <Trash2 className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
