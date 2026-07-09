"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { uploadModels } from "@/lib/api/uploads";
import { revalidateProject } from "@/lib/actions/revalidate";
import { useProjectDrop } from "@/components/project/project-drop-provider";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import type { ModelFormat } from "@/lib/types/database";
import { MODEL_FORMATS, formatBytes } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Box, CheckCircle, X } from "lucide-react";

interface ModelUploadFormProps {
  projectId: string;
}

interface QueuedModel {
  file: File;
  name: string;
  format: ModelFormat;
}

function inferFormat(filename: string): ModelFormat {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "onnx") return "onnx";
  if (ext === "pt" || ext === "pth") return "pytorch";
  if (ext === "tflite") return "tflite";
  if (ext === "pb" || ext === "h5") return "tensorflow";
  return "other";
}

function inferModelName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function toQueuedModel(file: File): QueuedModel {
  return {
    file,
    name: inferModelName(file.name),
    format: inferFormat(file.name),
  };
}

export function ModelUploadForm({ projectId }: ModelUploadFormProps) {
  const router = useRouter();
  const projectDrop = useProjectDrop();
  const [queue, setQueue] = useState<QueuedModel[]>([]);
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);

  const addFiles = useCallback((files: File[]) => {
    const models = files.filter((f) => !f.name.toLowerCase().endsWith(".zip"));
    if (models.length === 0) return;
    setQueue((prev) => [...prev, ...models.map(toQueuedModel)]);
  }, []);

  useEffect(() => {
    if (!projectDrop) return;
    const unregister = projectDrop.registerHandler("model", addFiles);
    const pending = projectDrop.consumePending("model");
    if (pending?.length) addFiles(pending);
    return unregister;
  }, [projectDrop, addFiles]);

  function removeFromQueue(index: number) {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  }

  function updateName(index: number, name: string) {
    setQueue((prev) =>
      prev.map((item, i) => (i === index ? { ...item, name } : item))
    );
  }

  function updateFormat(index: number, format: ModelFormat) {
    setQueue((prev) =>
      prev.map((item, i) => (i === index ? { ...item, format } : item))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (queue.length === 0) {
      setError("Add at least one model file");
      return;
    }
    if (queue.some((item) => !item.name.trim())) {
      setError("Every model needs a name");
      return;
    }

    setUploading(true);
    setError(null);
    setProgress(0);
    const names: string[] = [];
    const ver = version.trim() || "1.0.0";
    const desc = description.trim() || undefined;

    try {
      const payload = queue.map((item) => ({
        file: item.file,
        modelName: item.name.trim(),
        modelVersion: ver,
        modelType: item.format,
        description: desc,
      }));

      setUploadLabel(
        payload.length === 1
          ? `Uploading ${payload[0].file.name}`
          : `Uploading ${payload.length} models (one Hugging Face commit)…`
      );

      const result = await uploadModels(projectId, payload, (p) => setProgress(p));
      for (const model of result.models) {
        const label = model.modelName?.trim();
        if (label) {
          names.push(`${label} v${ver}`);
        }
      }

      setProgress(100);
      setUploadedNames(names);
      setDone(true);
      setUploading(false);
      await revalidateProject(projectId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
      setUploadLabel("");
    }
  }

  if (done) {
    return (
      <Card className="text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
        <h2 className="mt-4 text-lg font-semibold">
          {uploadedNames.length === 1 ? "Model uploaded" : `${uploadedNames.length} models uploaded`}
        </h2>
        <ul className="mt-3 space-y-1 text-sm text-slate-500">
          {uploadedNames.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <div className="mt-6 flex justify-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setDone(false);
              setQueue([]);
              setDescription("");
              setUploadedNames([]);
              setUploadLabel("");
            }}
          >
            Upload more
          </Button>
          <Button onClick={() => router.push(`/projects/${projectId}/models`)}>
            View models
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="Upload models"
          description="Upload one or more model files (.onnx, .pt, .tflite, etc.)"
        />

        <form onSubmit={handleSubmit} className="space-y-6">
          <FileDropZone
            onFiles={addFiles}
            multiple
            disabled={uploading}
            uploading={uploading}
            progress={progress}
            progressLabel={uploadLabel || "Uploading models…"}
            progressSublabel={`${progress}% complete`}
            accept=".onnx,.pt,.pth,.pb,.h5,.tflite"
            hint="Click or drag & drop model files"
            subhint="Files over 25 MB upload directly to storage; smaller files go through the worker"
          />

          {queue.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {queue.map((item, index) => (
                <li
                  key={`${item.file.name}-${index}`}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="rounded-lg bg-amber-50 p-2">
                      <Box className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="truncate text-sm font-medium text-slate-700">
                        {item.file.name}{" "}
                        <span className="font-normal text-slate-400">
                          ({formatBytes(item.file.size)})
                        </span>
                      </p>
                      <Input
                        label="Model name"
                        value={item.name}
                        onChange={(e) => updateName(index, e.target.value)}
                        placeholder="e.g. defect-detector-v1"
                        required
                        disabled={uploading}
                      />
                      <div className="space-y-1">
                        <label className="block text-sm font-medium text-slate-700">
                          Format
                        </label>
                        <select
                          value={item.format}
                          onChange={(e) =>
                            updateFormat(index, e.target.value as ModelFormat)
                          }
                          className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          disabled={uploading}
                        >
                          {MODEL_FORMATS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(index)}
                    disabled={uploading}
                    className="self-start text-slate-400 hover:text-red-500 disabled:opacity-50"
                    title="Remove"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {queue.length > 0 && (
            <>
              <Textarea
                label="Description (optional, applies to all)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What do these models do?"
                disabled={uploading}
              />

              <Input
                label="Version (applies to all)"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.0.0"
                disabled={uploading}
              />
            </>
          )}

          <Button type="submit" loading={uploading} disabled={queue.length === 0}>
            {uploading
              ? "Uploading…"
              : queue.length <= 1
                ? "Upload model"
                : `Upload ${queue.length} models`}
          </Button>
        </form>
      </Card>
    </div>
  );
}
