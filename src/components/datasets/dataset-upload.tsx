"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { registerDatasetFiles } from "@/lib/actions/datasets";
import type { Class } from "@/lib/types/database";
import { formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Upload, FileImage, X, CheckCircle } from "lucide-react";

interface DatasetUploadProps {
  projectId: string;
  datasetId: string;
  datasetName: string;
  classes: Class[];
}

interface QueuedFile {
  file: File;
  classId: string | null;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export function DatasetUpload({
  projectId,
  datasetId,
  datasetName,
  classes,
}: DatasetUploadProps) {
  const router = useRouter();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [defaultClassId, setDefaultClassId] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const newFiles: QueuedFile[] = Array.from(files).map((file) => ({
      file,
      classId: defaultClassId || null,
      status: "pending",
    }));
    setQueue((prev) => [...prev, ...newFiles]);
    setDone(false);
  }, [defaultClassId]);

  function removeFile(index: number) {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (queue.length === 0) return;
    setUploading(true);
    setError(null);

    const supabase = createClient();
    const uploaded: {
      fileName: string;
      filePath: string;
      fileSize: number;
      mimeType: string;
      classId: string | null;
    }[] = [];

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.status === "done") continue;

      setQueue((prev) =>
        prev.map((q, idx) => (idx === i ? { ...q, status: "uploading" } : q))
      );

      const ext = item.file.name.split(".").pop() ?? "bin";
      const filePath = `${projectId}/${datasetId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("datasets")
        .upload(filePath, item.file, { upsert: false });

      if (uploadError) {
        setQueue((prev) =>
          prev.map((q, idx) =>
            idx === i ? { ...q, status: "error", error: uploadError.message } : q
          )
        );
        continue;
      }

      uploaded.push({
        fileName: item.file.name,
        filePath,
        fileSize: item.file.size,
        mimeType: item.file.type,
        classId: item.classId,
      });

      setQueue((prev) =>
        prev.map((q, idx) => (idx === i ? { ...q, status: "done" } : q))
      );
    }

    if (uploaded.length > 0) {
      const result = await registerDatasetFiles(projectId, datasetId, uploaded);
      if (result?.error) {
        setError(result.error);
      } else {
        setDone(true);
        router.refresh();
      }
    }

    setUploading(false);
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}
      {done && (
        <Alert variant="success">
          Files uploaded successfully.{" "}
          <a
            href={`/projects/${projectId}/datasets`}
            className="font-medium underline"
          >
            Back to datasets
          </a>
        </Alert>
      )}

      <Card>
        <h2 className="mb-1 text-lg font-semibold">Upload to {datasetName}</h2>
        <p className="mb-4 text-sm text-slate-500">
          Images and data files (max 50 MB each)
        </p>

        {classes.length > 0 && (
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Default class label
            </label>
            <select
              value={defaultClassId}
              onChange={(e) => setDefaultClassId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">No label</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 transition-colors hover:border-brand-400 hover:bg-brand-50">
          <Upload className="mb-3 h-10 w-10 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">
            Click to select files or drag and drop
          </span>
          <span className="mt-1 text-xs text-slate-400">
            PNG, JPG, JPEG, WEBP, CSV, JSON
          </span>
          <input
            type="file"
            multiple
            accept="image/*,.csv,.json"
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
        </label>
      </Card>

      {queue.length > 0 && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">
              {queue.length} file{queue.length !== 1 ? "s" : ""} queued
            </h3>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload all"}
            </Button>
          </div>
          <ul className="divide-y divide-slate-100">
            {queue.map((item, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <FileImage className="h-5 w-5 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {item.file.name}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatBytes(item.file.size)}
                    {item.status === "error" && ` — ${item.error}`}
                  </p>
                </div>
                {classes.length > 0 && item.status === "pending" && (
                  <select
                    value={item.classId ?? ""}
                    onChange={(e) =>
                      setQueue((prev) =>
                        prev.map((q, idx) =>
                          idx === i
                            ? { ...q, classId: e.target.value || null }
                            : q
                        )
                      )
                    }
                    className="rounded border border-slate-200 px-2 py-1 text-xs"
                  >
                    <option value="">No label</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                {item.status === "done" && (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                )}
                {item.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
