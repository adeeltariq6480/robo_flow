"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { registerDatasetFiles } from "@/lib/actions/datasets";
import { uploadWithProgress } from "@/lib/upload/xhr";
import type { Class } from "@/lib/types/database";
import { ALL_CLASS_ID } from "@/lib/classes/constants";
import { ClassSelect } from "@/components/ui/class-select";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CircularProgress } from "@/components/ui/circular-progress";
import { Upload, FileImage, X, CheckCircle } from "lucide-react";
import { formatBytes } from "@/lib/utils";

interface DatasetUploadFormProps {
  projectId: string;
  datasetId: string;
  datasetName: string;
  classes: Class[];
}

interface QueuedFile {
  file: File;
  classId: string;
  preview?: string;
}

export function DatasetUploadForm({
  projectId,
  datasetId,
  datasetName,
  classes,
}: DatasetUploadFormProps) {
  const router = useRouter();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [defaultClassId, setDefaultClassId] = useState(ALL_CLASS_ID);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onFilesSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const newItems: QueuedFile[] = files.map((file) => ({
        file,
        classId: defaultClassId || ALL_CLASS_ID,
        preview: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      }));
      setQueue((prev) => [...prev, ...newItems]);
      e.target.value = "";
    },
    [defaultClassId]
  );

  function removeFromQueue(index: number) {
    setQueue((prev) => {
      const item = prev[index];
      if (item.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  function updateClass(index: number, classId: string) {
    setQueue((prev) =>
      prev.map((item, i) => (i === index ? { ...item, classId } : item))
    );
  }

  async function handleUpload() {
    if (queue.length === 0) return;
    setUploading(true);
    setError(null);
    setProgress(0);

    const uploaded: {
      fileName: string;
      filePath: string;
      fileSize: number;
      mimeType: string;
      classId?: string | null;
    }[] = [];

    for (let i = 0; i < queue.length; i++) {
      const { file, classId } = queue[i];
      const fd = new FormData();
      fd.append("file", file);

      const uploadUrl = `/api/projects/${projectId}/datasets/${datasetId}/upload`;
      const fileBase = (i / queue.length) * 100;

      const result = await uploadWithProgress<{
        error?: string;
        file?: {
          fileName: string;
          filePath: string;
          fileSize: number;
          mimeType: string;
        };
      }>(uploadUrl, fd, (filePercent) => {
        const overall = Math.round(fileBase + filePercent / queue.length);
        setProgress(Math.min(99, overall));
      });

      if (!result.ok || result.data?.error) {
        setError(
          `Failed to upload ${file.name}: ${result.data?.error ?? `HTTP ${result.status}`}`
        );
        setUploading(false);
        return;
      }

      if (result.data.file) {
        uploaded.push({
          fileName: result.data.file.fileName,
          filePath: result.data.file.filePath,
          fileSize: result.data.file.fileSize,
          mimeType: result.data.file.mimeType,
          classId: classId && classId !== ALL_CLASS_ID ? classId : null,
        });
      }

      setProgress(Math.round(((i + 1) / queue.length) * 100));
    }

    const result = await registerDatasetFiles(projectId, datasetId, uploaded);
    if (result?.error) {
      setError(result.error);
      setUploading(false);
      return;
    }

    setDone(true);
    setUploading(false);
    router.refresh();
  }

  if (done) {
    return (
      <Card className="text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
        <h2 className="mt-4 text-lg font-semibold">Upload complete</h2>
        <p className="mt-2 text-sm text-slate-500">
          {queue.length} file{queue.length !== 1 ? "s" : ""} added to {datasetName}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setDone(false);
              setQueue([]);
              setProgress(0);
            }}
          >
            Upload more
          </Button>
          <Button onClick={() => router.push(`/projects/${projectId}/datasets`)}>
            View datasets
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
          title={`Upload to ${datasetName}`}
          description="Add images or data files. Assign a class label to each file."
        />

        {classes.length > 0 && (
          <div className="mb-4 max-w-xs">
            <ClassSelect
              label="Default class for new files"
              classes={classes}
              value={defaultClassId}
              onChange={setDefaultClassId}
              disabled={uploading}
            />
          </div>
        )}

        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 transition-colors hover:border-brand-500 hover:bg-brand-50/50">
          <Upload className="h-10 w-10 text-slate-400" />
          <span className="mt-3 text-sm font-medium text-slate-700">
            Click to select files
          </span>
          <span className="mt-1 text-xs text-slate-500">
            Images, CSV, JSON — up to 50 MB each
          </span>
          <input
            type="file"
            multiple
            accept="image/*,.csv,.json,.txt,.zip"
            className="sr-only"
            onChange={onFilesSelected}
            disabled={uploading}
          />
        </label>

        {queue.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-medium text-slate-700">
              {queue.length} file{queue.length !== 1 ? "s" : ""} queued
            </h3>
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {queue.map((item, index) => (
                <li
                  key={index}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"
                >
                  {item.preview ? (
                    <img
                      src={item.preview}
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <FileImage className="h-10 w-10 text-slate-300" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.file.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatBytes(item.file.size)}
                    </p>
                  </div>
                  {classes.length > 0 && (
                    <ClassSelect
                      classes={classes}
                      value={item.classId || ALL_CLASS_ID}
                      onChange={(value) => updateClass(index, value)}
                      includeAll
                      disabled={uploading}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeFromQueue(index)}
                    disabled={uploading}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>

            {uploading && (
              <div className="mt-6 flex justify-center py-4">
                <CircularProgress
                  value={progress}
                  label="Uploading files…"
                  sublabel={`${progress}% complete`}
                />
              </div>
            )}

            <div className="mt-4 flex gap-3">
              <Button onClick={handleUpload} disabled={uploading}>
                {uploading ? "Uploading…" : `Upload ${queue.length} file${queue.length !== 1 ? "s" : ""}`}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setQueue([])}
                disabled={uploading}
              >
                Clear queue
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
