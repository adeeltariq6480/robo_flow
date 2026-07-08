"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  buildUploadBatches,
  checkDatasetHfFiles,
  finalizeDatasetHfUpload,
  uploadImages,
  uploadZip,
} from "@/lib/api/uploads";
import { revalidateProject } from "@/lib/actions/revalidate";
import { useProjectDrop } from "@/components/project/project-drop-provider";
import type { Class } from "@/lib/types/database";
import { ALL_CLASS_ID } from "@/lib/classes/constants";
import {
  clearUploadSession,
  loadUploadFiles,
  loadUploadSession,
  saveUploadFiles,
  saveUploadSession,
  type PersistedUploadSession,
} from "@/lib/upload/upload-session-store";
import { ClassSelect } from "@/components/ui/class-select";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { FileImage, X, CheckCircle, PauseCircle, Play, CloudUpload } from "lucide-react";
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

type UploadPhase = "idle" | "uploading" | "paused" | "hf_syncing" | "done";

export function DatasetUploadForm({
  projectId,
  datasetId,
  datasetName,
  classes,
}: DatasetUploadFormProps) {
  const router = useRouter();
  const projectDrop = useProjectDrop();
  const abortRef = useRef<AbortController | null>(null);

  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [defaultClassId, setDefaultClassId] = useState(ALL_CLASS_ID);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [hfStatus, setHfStatus] = useState<string | null>(null);
  const [restoredSession, setRestoredSession] =
    useState<PersistedUploadSession | null>(null);
  const [uploadSummary, setUploadSummary] = useState<{
    uploaded: number;
    skipped: { fileName: string; reason?: string; message?: string }[];
    adjusted: { fileName: string; message?: string }[];
  } | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);

  const uploading = phase === "uploading" || phase === "hf_syncing";
  const paused = phase === "paused";
  const done = phase === "done";

  const persistSession = useCallback(
    (patch: Partial<PersistedUploadSession>) => {
      const base: PersistedUploadSession = {
        projectId,
        datasetId,
        datasetName,
        workerSessionId: restoredSession?.workerSessionId ?? "",
        status:
          phase === "hf_syncing"
            ? "hf_syncing"
            : phase === "paused"
              ? "paused"
              : phase === "done"
                ? "completed"
                : phase === "uploading"
                  ? "uploading"
                  : "uploading",
        totalFiles: restoredSession?.totalFiles ?? queue.length,
        completedFiles: restoredSession?.completedFiles ?? 0,
        completedBatches: restoredSession?.completedBatches ?? 0,
        totalBatches: restoredSession?.totalBatches ?? buildUploadBatches(queue.map((q) => q.file)).length,
        progress,
        fileNames: restoredSession?.fileNames ?? queue.map((q) => q.file.name),
        processing,
        updatedAt: Date.now(),
        ...patch,
      };
      saveUploadSession(base);
      setRestoredSession(base);
    },
    [projectId, datasetId, datasetName, phase, progress, queue, restoredSession, processing]
  );

  const runHfFinalize = useCallback(async () => {
    setPhase("hf_syncing");
    setHfStatus("Pushing images to Hugging Face…");
    persistSession({ status: "hf_syncing" });
    try {
      await finalizeDatasetHfUpload(projectId, datasetId);
      const check = await checkDatasetHfFiles(projectId, datasetId);
      setHfStatus(
        `${check.matchedByFilename}/${check.dbImagesCount} images found on Hugging Face`
      );
      if (check.missingRemote > 0) {
        setHfStatus(
          `${check.matchedByFilename} on HF · ${check.missingRemote} still missing — check HF_DATASET_REPO on Railway`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "HF sync failed";
      setHfStatus(message);
      setError(message);
    }
  }, [projectId, datasetId, persistSession]);

  const runUpload = useCallback(
    async (
      files: File[],
      options?: {
        resume?: boolean;
        workerSessionId?: string;
        startBatchIndex?: number;
        completedFiles?: number;
      }
    ) => {
      if (files.length === 0) return;

      const batches = buildUploadBatches(files);
      const workerSessionId = options?.workerSessionId;
      const startBatchIndex = options?.startBatchIndex ?? 0;
      const initialCompleted = options?.completedFiles ?? 0;

      if (!options?.resume) {
        await saveUploadFiles(projectId, datasetId, files);
      }

      abortRef.current = new AbortController();
      setPhase("uploading");
      setError(null);
      setProgress(
        files.length > 0
          ? Math.round((initialCompleted / files.length) * 100)
          : 0
      );
      setProcessing(false);
      setHfStatus(null);

      persistSession({
        status: "uploading",
        totalFiles: files.length,
        completedFiles: initialCompleted,
        completedBatches: startBatchIndex,
        totalBatches: batches.length,
        fileNames: files.map((f) => f.name),
        workerSessionId: workerSessionId ?? "",
        progress: Math.round((initialCompleted / files.length) * 100),
      });

      const zips = files.filter((f) => f.name.toLowerCase().endsWith(".zip"));
      const images = files.filter((f) => !f.name.toLowerCase().endsWith(".zip"));

      const summary = {
        uploaded: options?.resume ? (restoredSession?.summary?.uploaded ?? 0) : 0,
        skipped: [...(restoredSession?.summary?.skipped ?? [])],
        adjusted: [...(restoredSession?.summary?.adjusted ?? [])],
      };

      let queuedBackgroundUpload = false;
      let activeWorkerSessionId = workerSessionId;

      try {
        if (images.length > 0) {
          const result = await uploadImages(projectId, datasetId, images, {
            signal: abortRef.current.signal,
            uploadSessionId: workerSessionId,
            startBatchIndex,
            onWorkerSessionId: (id) => {
              activeWorkerSessionId = id;
              persistSession({ workerSessionId: id });
            },
            onProgress: (p) => {
              setProgress(Math.min(99, p));
              persistSession({ progress: Math.min(99, p) });
            },
            onBatchComplete: (batchIndex, completedFiles) => {
              persistSession({
                completedBatches: batchIndex,
                completedFiles,
                workerSessionId: activeWorkerSessionId ?? "",
              });
            },
          });
          summary.uploaded += result.uploaded;
          summary.skipped.push(...(result.skipped ?? []));
          summary.adjusted.push(...(result.adjusted ?? []));
          queuedBackgroundUpload = Boolean(result.processing);
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
        const message = err instanceof Error ? err.message : "Upload failed";
        if (message === "Upload cancelled") {
          setPhase("paused");
          persistSession({
            status: "paused",
            error: "Upload paused",
            summary,
          });
          return;
        }
        setPhase("paused");
        setError(message);
        persistSession({ status: "paused", error: message, summary });
        return;
      }

      setProgress(100);
      setUploadSummary(summary);
      setProcessing(queuedBackgroundUpload);
      persistSession({
        status: "hf_syncing",
        progress: 100,
        summary,
        processing: queuedBackgroundUpload,
        completedFiles: files.length,
        completedBatches: batches.length,
      });

      await runHfFinalize();

      setPhase("done");
      persistSession({ status: "completed", progress: 100, summary });
      await clearUploadSession(projectId, datasetId);
      setRestoredSession(null);
      setQueue([]);

      await revalidateProject(projectId);
      router.refresh();
    },
    [projectId, datasetId, persistSession, restoredSession, router, runHfFinalize]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = loadUploadSession(projectId, datasetId);
      if (!saved || cancelled) return;
      if (saved.status === "completed") {
        await clearUploadSession(projectId, datasetId);
        return;
      }
      setRestoredSession(saved);
      setUploadSummary(saved.summary ?? null);
      setProgress(saved.progress);
      setProcessing(Boolean(saved.processing));
      if (saved.status === "paused") {
        setPhase("paused");
        setError(saved.error ?? "Upload was interrupted");
      } else if (saved.status === "hf_syncing") {
        setPhase("hf_syncing");
        setHfStatus("Finishing Hugging Face upload…");
        void runHfFinalize().then(() => {
          if (!cancelled) setPhase("done");
        });
      } else if (saved.status === "uploading") {
        setPhase("paused");
        setError("Upload was interrupted — tap Resume to continue");
      } else if (saved.status === "failed") {
        setPhase("paused");
        setError(saved.error ?? "Upload failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, datasetId, runHfFinalize]);

  useEffect(() => {
    if (!uploading) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  const addFilesToQueue = useCallback(
    async (files: File[]) => {
      const newItems: QueuedFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        newItems.push({
          file,
          classId: defaultClassId || ALL_CLASS_ID,
          preview: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined,
        });
        if (i > 0 && i % 50 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
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
    await runUpload(queue.map((q) => q.file));
  }

  async function handleResume() {
    const saved = restoredSession ?? loadUploadSession(projectId, datasetId);
    const files = await loadUploadFiles(projectId, datasetId);
    if (files.length === 0) {
      setError("Saved files not found — add images again and upload.");
      await clearUploadSession(projectId, datasetId);
      setPhase("idle");
      setRestoredSession(null);
      return;
    }
    await runUpload(files, {
      resume: true,
      workerSessionId: saved?.workerSessionId || undefined,
      startBatchIndex: saved?.completedBatches ?? 0,
      completedFiles: saved?.completedFiles ?? 0,
    });
  }

  async function handleCancel() {
    abortRef.current?.abort();
    await clearUploadSession(projectId, datasetId);
    setRestoredSession(null);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setHfStatus(null);
    setUploadSummary(null);
    setProcessing(false);
    setQueue([]);
  }

  async function handleRetryHf() {
    setError(null);
    await runHfFinalize();
  }

  if (done) {
    const skipped = uploadSummary?.skipped ?? [];
    const adjusted = uploadSummary?.adjusted ?? [];
    const uploaded = uploadSummary?.uploaded ?? 0;
    const blurrySkipped = skipped.filter((item) => item.reason === "blurry").length;

    return (
      <Card className="text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
        <h2 className="mt-4 text-lg font-semibold">Upload complete</h2>
        <p className="mt-2 text-sm text-slate-500">
          {uploaded} image{uploaded !== 1 ? "s" : ""} saved to {datasetName}
        </p>
        {hfStatus && (
          <p className="mt-2 text-sm text-slate-600">{hfStatus}</p>
        )}
        {processing && (
          <p className="mt-2 text-sm text-amber-700">
            Worker is finishing background processing.
          </p>
        )}

        {(adjusted.length > 0 || skipped.length > 0) && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p>
              {adjusted.length} rotated · {skipped.length} skipped
              {blurrySkipped > 0 ? ` (${blurrySkipped} blurry)` : ""}
            </p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => setShowReportModal(true)}
            >
              View upload report
            </Button>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setPhase("idle");
              setQueue([]);
              setProgress(0);
              setUploadSummary(null);
              setShowReportModal(false);
              setHfStatus(null);
            }}
          >
            Upload more
          </Button>
          <Button onClick={() => router.push(`/projects/${projectId}/datasets`)}>
            View datasets
          </Button>
        </div>

        {showReportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">Upload report</h3>
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="max-h-[calc(80vh-64px)] space-y-4 overflow-y-auto p-5 text-left">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  <p className="font-medium">Auto-rotated ({adjusted.length})</p>
                  {adjusted.length > 0 ? (
                    <ul className="mt-2 list-inside list-disc text-blue-800">
                      {adjusted.map((item) => (
                        <li key={`adj-${item.fileName}`}>
                          {item.fileName}
                          {item.message ? ` — ${item.message}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-blue-800">No rotated images.</p>
                  )}
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-medium">
                    Skipped ({skipped.length}){blurrySkipped > 0 ? ` · Blurry: ${blurrySkipped}` : ""}
                  </p>
                  {skipped.length > 0 ? (
                    <ul className="mt-2 list-inside list-disc text-amber-800">
                      {skipped.map((item) => (
                        <li key={`skip-${item.fileName}`}>
                          {item.fileName}
                          {item.reason ? ` [${item.reason}]` : ""}
                          {item.message ? ` — ${item.message}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-amber-800">No skipped images.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>
    );
  }

  if (uploading || paused || phase === "hf_syncing") {
    const total = restoredSession?.totalFiles ?? queue.length;
    const completed = restoredSession?.completedFiles ?? 0;

    return (
      <Card>
        <div className="text-center">
          {phase === "hf_syncing" ? (
            <CloudUpload className="mx-auto h-12 w-12 text-brand-600" />
          ) : paused ? (
            <PauseCircle className="mx-auto h-12 w-12 text-amber-500" />
          ) : (
            <FileImage className="mx-auto h-12 w-12 text-brand-600" />
          )}

          <h2 className="mt-4 text-lg font-semibold">
            {phase === "hf_syncing"
              ? "Syncing to Hugging Face"
              : paused
                ? "Upload paused"
                : "Uploading images"}
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            {phase === "hf_syncing"
              ? hfStatus ?? "Pushing files to your HF dataset repo…"
              : `${completed} of ${total} files sent to server · ${progress}%`}
          </p>

          {phase !== "hf_syncing" && (
            <div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${Math.max(progress, 2)}%` }}
              />
            </div>
          )}

          {error && (
            <div className="mt-4">
              <Alert variant="error">{error}</Alert>
            </div>
          )}

          {hfStatus && phase === "hf_syncing" && (
            <p className="mt-3 text-sm text-slate-600">{hfStatus}</p>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {paused && (
              <Button onClick={handleResume}>
                <Play className="h-4 w-4" />
                Resume upload
              </Button>
            )}
            {(paused || phase === "hf_syncing") && (
              <Button variant="secondary" onClick={handleRetryHf}>
                <CloudUpload className="h-4 w-4" />
                Retry HF sync
              </Button>
            )}
            <Button variant="secondary" onClick={handleCancel}>
              {uploading ? "Stop upload" : "Cancel"}
            </Button>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            You can reload this page — progress is saved. Use Resume to continue.
          </p>
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
          description="Images are auto-rotated to portrait when needed. Blurry photos are skipped. Progress survives page reload."
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
          uploading={uploading}
          progress={progress}
          prepareLabel="Adding files to queue…"
          prepareSublabel="Preparing previews for selected images"
          progressLabel={
            uploading && queue.length > 0
              ? `Uploading batch… (${queue.length} file${queue.length !== 1 ? "s" : ""} total)`
              : "Uploading files…"
          }
          progressSublabel={`${progress}% complete`}
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
