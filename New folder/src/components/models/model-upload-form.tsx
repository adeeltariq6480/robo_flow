"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { uploadModel } from "@/lib/api/uploads";
import { useProjectDrop } from "@/components/project/project-drop-provider";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import type { ModelFormat } from "@/lib/types/database";
import { MODEL_FORMATS, formatBytes } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CircularProgress } from "@/components/ui/circular-progress";
import { Box, CheckCircle, X } from "lucide-react";

interface ModelUploadFormProps {
  projectId: string;
}

export function ModelUploadForm({ projectId }: ModelUploadFormProps) {
  const router = useRouter();
  const projectDrop = useProjectDrop();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<ModelFormat>("onnx");
  const [version, setVersion] = useState("1.0.0");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const applyModelFile = useCallback((selected: File) => {
    setFile(selected);
    setName((prev) => {
      if (prev) return prev;
      return selected.name.replace(/\.[^.]+$/, "");
    });
    const ext = selected.name.split(".").pop()?.toLowerCase();
    if (ext === "onnx") setFormat("onnx");
    else if (ext === "pt" || ext === "pth") setFormat("pytorch");
    else if (ext === "tflite") setFormat("tflite");
    else if (ext === "pb" || ext === "h5") setFormat("tensorflow");
  }, []);

  useEffect(() => {
    if (!projectDrop) return;
    const unregister = projectDrop.registerHandler("model", (files) => {
      if (files[0]) applyModelFile(files[0]);
    });
    const pending = projectDrop.consumePending("model");
    if (pending?.[0]) applyModelFile(pending[0]);
    return unregister;
  }, [projectDrop, applyModelFile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) {
      setError("Model name and file are required");
      return;
    }

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      await uploadModel(
        projectId,
        {
          file,
          modelName: name.trim(),
          modelVersion: version.trim() || "1.0.0",
          modelType: format,
          description: description.trim() || undefined,
        },
        setProgress
      );

      setProgress(100);
      setDone(true);
      setUploading(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  }

  if (done) {
    return (
      <Card className="text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
        <h2 className="mt-4 text-lg font-semibold">Model uploaded</h2>
        <p className="mt-2 text-sm text-slate-500">
          {name} v{version} is ready to use.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setDone(false);
              setFile(null);
              setName("");
              setDescription("");
            }}
          >
            Upload another
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
          title="Upload model"
          description="Upload a trained model file (.onnx, .pt, .tflite, etc.)"
        />

        <form onSubmit={handleSubmit} className="space-y-6">
          {!file ? (
            <FileDropZone
              onFiles={(files) => files[0] && applyModelFile(files[0])}
              multiple={false}
              disabled={uploading}
              accept=".onnx,.pt,.pth,.pb,.h5,.tflite,.zip"
              hint="Click or drag & drop model file"
              subhint="Up to 500 MB — .pt, .onnx, .tflite, etc."
            />
          ) : (
            <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <Box className="h-10 w-10 text-brand-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{file.name}</p>
                <p className="text-sm text-slate-500">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="text-slate-400 hover:text-red-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}

          <Input
            label="Model name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. defect-detector-v1"
            required
          />

          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What does this model do?"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700">
                Format
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ModelFormat)}
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
            <Input
              label="Version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0.0"
              disabled={uploading}
            />
          </div>

          {uploading && (
            <div className="flex justify-center py-4">
              <CircularProgress
                value={progress}
                label="Uploading model…"
                sublabel={`${progress}% complete`}
              />
            </div>
          )}

          <Button type="submit" loading={uploading} disabled={!file}>
            {uploading ? "Uploading…" : "Upload model"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
