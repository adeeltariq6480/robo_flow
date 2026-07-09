"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteModel,
  deleteModels,
  deleteAllModels,
  syncModelsToHuggingFace,
} from "@/lib/actions/models";
import { fetchModelsAvailability } from "@/lib/actions/inference";
import type { Model } from "@/lib/types/database";
import { formatBytes } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import { BulkDeleteToolbar } from "@/components/ui/bulk-delete-toolbar";
import { SimpleToast } from "@/components/ui/simple-toast";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { setDeleteStatus } from "@/lib/delete-status";
import { Box, Plus, Upload, Trash2, CloudUpload } from "lucide-react";

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
  const [toast, setToast] = useState<{ open: boolean; message: string; type: "success" | "error" }>({
    open: false,
    message: "",
    type: "success",
  });
  const [missingOnHf, setMissingOnHf] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => {
    fetchModelsAvailability(projectId).then((result) => {
      if ("error" in result) return;
      setMissingOnHf(result.missingCount ?? 0);
    });
  }, [projectId, models.length]);

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
    if (!(await confirm({ title: "Delete models?", message: `Delete ${selected.size} selected model(s)?` }))) return;
    setLoading(true);
    setDeleteStatus(true, "Deleting models in background...");
    const result = await deleteModels(projectId, Array.from(selected));
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
      setToast({ open: true, message: "Models deleted", type: "success" });
      setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
    }
    setLoading(false);
    setDeleteStatus(false);
  }

  async function handleDeleteAll() {
    if (!(await confirm({ title: "Delete all models?", message: "Delete ALL models in this project?" }))) return;
    setLoading(true);
    setDeleteStatus(true, "Deleting all models in background...");
    const result = await deleteAllModels(projectId);
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
      setToast({ open: true, message: "All models deleted", type: "success" });
      setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
    }
    setLoading(false);
    setDeleteStatus(false);
  }

  async function handleDeleteOne(modelId: string) {
    if (!(await confirm({ title: "Delete model?", message: "Delete this model?" }))) return;
    setLoading(true);
    setDeletingId(modelId);
    setDeleteStatus(true, "Deleting model in background...");
    const result = await deleteModel(projectId, modelId);
    if (result?.error) setError(result.error);
    else {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
      router.refresh();
      setToast({ open: true, message: "Model deleted", type: "success" });
      setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
    }
    setDeletingId(null);
    setLoading(false);
    setDeleteStatus(false);
  }

  async function handleSyncToHf() {
    setSyncing(true);
    setError(null);
    const result = await syncModelsToHuggingFace(projectId);
    if (result.error) {
      setError(result.error);
      setSyncing(false);
      return;
    }
    setToast({
      open: true,
      message: result.message ?? `Synced ${result.uploaded ?? 0} model(s) to Hugging Face`,
      type: "success",
    });
    setMissingOnHf(0);
    router.refresh();
    setSyncing(false);
    setTimeout(() => setToast((t) => ({ ...t, open: false })), 3000);
  }

  return (
    <div className="space-y-6">
      <SimpleToast open={toast.open} message={toast.message} type={toast.type} />
      {dialog}
      {error && <Alert variant="error">{error}</Alert>}

      {missingOnHf > 0 && (
        <Alert variant="warning">
          <p className="font-medium">
            {missingOnHf} model{missingOnHf !== 1 ? "s" : ""} Hugging Face par nahi mile
          </p>
          <p className="mt-1 text-sm">
            Models sirf database mein hain — HF repo empty ho sakta hai. Pehle{" "}
            <strong>Push to Hugging Face</strong> try karein (agar Railway disk par files hain),
            warna dubara upload karein. Models <strong>model repo</strong> mein save hoti hain
            (images wala dataset repo alag hota hai — same name ho sakta hai lekin URL different).
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={handleSyncToHf}
            loading={syncing}
          >
            {!syncing && <CloudUpload className="h-4 w-4" />}
            Push to Hugging Face
          </Button>
        </Alert>
      )}

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
