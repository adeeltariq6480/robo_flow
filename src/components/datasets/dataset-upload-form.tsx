"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { uploadImages, uploadZip } from "@/lib/api/uploads";
import { useProjectDrop } from "@/components/project/project-drop-provider";
import type { Class } from "@/lib/types/database";
import { ALL_CLASS_ID } from "@/lib/classes/constants";
import { ClassSelect } from "@/components/ui/class-select";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CircularProgress } from "@/components/ui/circular-progress";
import { FileImage, X, CheckCircle } from "lucide-react";
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
  const projectDrop = useProjectDrop();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [defaultClassId, setDefaultClassId] = useState(ALL_CLASS_ID);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<{
    uploaded: number;
    skipped: { fileName: string; message?: string }[];
    adjusted: { fileName: string; message?: string }[];
  } | null>(null);

  const addFilesToQueue = useCallback(
    (files: File[]) => {
      const newItems: QueuedFile[] = files.map((file) => ({
        file,
        classId: defaultClassId || ALL_CLASS_ID,
        preview: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      }));
      setQueue((prev) => [...prev, ...newItems]);
    },
    [defaultClassId]
  );

  useEffect(() => {
    if (!projectDrop) return;
    const unregister = projectDrop.registerHandler("images", addFilesToQueue);
    const pending = projectDrop.consumePending("images");
    if (pending?.length) addFilesToQueue(pending);
    return unregister;
  }, [projectDrop, addFilesToQueue]);

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

    const zips = queue
      .map((q) => q.file)
      .filter((f) => f.name.toLowerCase().endsWith(".zip"));
    const images = queue
      .map((q) => q.file)
      .filter((f) => !f.name.toLowerCase().endsWith(".zip"));

    const summary = {
      uploaded: 0,
      skipped: [] as { fileName: string; message?: string }[],
      adjusted: [] as { fileName: string; message?: string }[],
    };

    try {
      if (images.length > 0) {
        const result = await uploadImages(projectId, datasetId, images, (p) =>
          setProgress(Math.min(99, p))
        );
        summary.uploaded += result.uploaded;
        summary.skipped.push(...(result.skipped ?? []));
        summary.adjusted.push(...(result.adjusted ?? []));
      }
      for (const zip of zips) {
        const result = await uploadZip(projectId, datasetId, zip, (p) =>
          setProgress(Math.min(99, p))
        );
        summary.uploaded += result.uploaded;
        summary.skipped.push(...(result.skipped ?? []));
        summary.adjusted.push(...(result.adjusted ?? []));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
      return;
    }

    setProgress(100);
    setUploadSummary(summary);
    setDone(true);
    setUploading(false);
    router.refresh();
  }

  if (done) {
    const skipped = uploadSummary?.skipped ?? [];
    const adjusted = uploadSummary?.adjusted ?? [];
    const uploaded = uploadSummary?.uploaded ?? 0;

    return (
      <Card className="text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
        <h2 className="mt-4 text-lg font-semibold">Upload complete</h2>
        <p className="mt-2 text-sm text-slate-500">
          {uploaded} image{uploaded !== 1 ? "s" : ""} saved to {datasetName}
        </p>

        {adjusted.length > 0 && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm text-blue-900">
            <p className="font-medium">Auto-fixed orientation</p>
            <ul className="mt-2 list-inside list-disc text-blue-800">
              {adjusted.map((item) => (
                <li key={item.fileName}>
                  {item.fileName}
                  {item.message ? ` — ${item.message}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {skipped.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900">
            <p className="font-medium">Skipped automatically</p>
            <ul className="mt-2 list-inside list-disc text-amber-800">
              {skipped.map((item) => (
                <li key={item.fileName}>
                  {item.fileName}
                  {item.message ? ` — ${item.message}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex justify-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setDone(false);
              setQueue([]);
              setProgress(0);
              setUploadSummary(null);
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
          description="Images are auto-rotated to portrait when needed. Blurry photos are skipped."
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

        <FileDropZone
          onFiles={addFilesToQueue}
          disabled={uploading}
          multiple
          accept="image/*,.csv,.json,.txt,.zip"
          hint="Click or drag & drop files here"
          subhint="Multiple images at once · up to 50 MB each"
        />

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
              <Button onClick={handleUpload} loading={uploading}>
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
