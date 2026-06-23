"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { registerModel } from "@/lib/actions/models";
import type { ModelFormat } from "@/lib/types/database";
import { MODEL_FORMATS, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Upload, Box, CheckCircle } from "lucide-react";

interface ModelUploadProps {
  projectId: string;
}

export function ModelUpload({ projectId }: ModelUploadProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<ModelFormat>("onnx");
  const [version, setVersion] = useState("1.0.0");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleFileSelect(files: FileList | null) {
    const selected = files?.[0];
    if (!selected) return;
    setFile(selected);
    if (!name) setName(selected.name.replace(/\.[^.]+$/, ""));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) {
      setError("Model name and file are required");
      return;
    }

    setUploading(true);
    setError(null);

    const supabase = createClient();
    const ext = file.name.split(".").pop() ?? "bin";
    const filePath = `${projectId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("models")
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const result = await registerModel(projectId, {
      name: name.trim(),
      description: description.trim() || null,
      filePath,
      fileSize: file.size,
      format,
      version: version.trim(),
    });

    if (result?.error) {
      setError(result.error);
    } else {
      setDone(true);
      router.refresh();
      setTimeout(() => {
        router.push(`/projects/${projectId}/models`);
      }, 1500);
    }

    setUploading(false);
  }

  if (done) {
    return (
      <Card className="text-center py-12">
        <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-500" />
        <h2 className="text-lg font-semibold text-slate-900">Model uploaded</h2>
        <p className="mt-2 text-sm text-slate-500">Redirecting to models…</p>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Model file</h2>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 transition-colors hover:border-brand-400 hover:bg-brand-50">
          {file ? (
            <>
              <Box className="mb-3 h-10 w-10 text-brand-600" />
              <span className="text-sm font-medium text-slate-900">{file.name}</span>
              <span className="mt-1 text-xs text-slate-400">{formatBytes(file.size)}</span>
            </>
          ) : (
            <>
              <Upload className="mb-3 h-10 w-10 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">
                Select model file
              </span>
              <span className="mt-1 text-xs text-slate-400">
                ONNX, PyTorch, TensorFlow, TFLite (max 500 MB)
              </span>
            </>
          )}
          <input
            type="file"
            accept=".onnx,.pt,.pth,.pb,.tflite,.h5,.keras,.bin"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </label>
      </Card>

      <Card className="space-y-4">
        <Input
          label="Model name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. defect-detector-v1"
          required
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={3}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Format
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ModelFormat)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
          />
        </div>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={uploading || !file}>
          {uploading ? "Uploading…" : "Upload model"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(`/projects/${projectId}/models`)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
