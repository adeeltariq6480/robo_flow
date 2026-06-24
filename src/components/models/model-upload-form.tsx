"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerModel } from "@/lib/actions/models";
import { prepareModelUpload } from "@/lib/actions/uploads";
import { uploadFileToStorage } from "@/lib/upload/direct-storage";
import type { ModelFormat } from "@/lib/types/database";
import { MODEL_FORMATS, formatBytes } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CircularProgress } from "@/components/ui/circular-progress";
import { Upload, Box, CheckCircle, X } from "lucide-react";

interface ModelUploadFormProps {
  projectId: string;
}

export function ModelUploadForm({ projectId }: ModelUploadFormProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<ModelFormat>("onnx");
  const [version, setVersion] = useState("1.0.0");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    if (!name) {
      const baseName = selected.name.replace(/\.[^.]+$/, "");
      setName(baseName);
    }
    const ext = selected.name.split(".").pop()?.toLowerCase();
    if (ext === "onnx") setFormat("onnx");
    else if (ext === "pt" || ext === "pth") setFormat("pytorch");
    else if (ext === "tflite") setFormat("tflite");
    else if (ext === "pb" || ext === "h5") setFormat("tensorflow");
    e.target.value = "";
  }

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
      const prepared = await prepareModelUpload(projectId, file.name);
      if (!prepared?.filePath) {
        setError("Could not prepare upload");
        setUploading(false);
        return;
      }

      const uploadResult = await uploadFileToStorage(
        "models",
        prepared.filePath,
        file,
        setProgress
      );

      if (uploadResult.error) {
        setError(uploadResult.error);
        setUploading(false);
        return;
      }

      setProgress(100);

      const result = await registerModel(projectId, {
        name: name.trim(),
        description: description.trim() || null,
        filePath: prepared.filePath,
        fileSize: file.size,
        format,
        version: version.trim() || "1.0.0",
      });

      if (result?.error) {
        setError(result.error);
        setUploading(false);
        return;
      }

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
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 transition-colors hover:border-brand-500 hover:bg-brand-50/50">
              <Upload className="h-10 w-10 text-slate-400" />
              <span className="mt-3 text-sm font-medium text-slate-700">
                Select model file
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Up to 500 MB — uploads go directly to storage
              </span>
              <input
                type="file"
                accept=".onnx,.pt,.pth,.pb,.h5,.tflite,.zip"
                className="sr-only"
                onChange={onFileSelected}
              />
            </label>
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

          <Button type="submit" disabled={uploading || !file}>
            {uploading ? "Uploading…" : "Upload model"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
