"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  buildUploadBatches,
  syncDatasetToHf,
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
  normalizeUploadSummary,
  type PersistedUploadSummary,
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
  const sessionRestoreRef = useRef(false);
  const hfSyncTaskRef = useRef<Promise<void> | null>(null);
  const persistSessionRef = useRef<(patch: Partial<PersistedUploadSession>) => void>(
    () => {}
  );

  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [defaultClassId, setDefaultClassId] = useState(ALL_CLASS_ID);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [hfStatus, setHfStatus] = useState<string | null>(null);
  const [restoredSession, setRestoredSession] =
    useState<PersistedUploadSession | null>(null);
  const [uploadSummary, setUploadSummary] = useState<PersistedUploadSummary | null>(
    null
  );
  const [showReportModal, setShowReportModal] = useState(false);

  const uploading = phase === "uploading" || phase === "hf_syncing";
  const paused = phase === "paused";
  const done = phase === "done";
  const [preparing, setPreparing] = useState(false);

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

  persistSessionRef.current = persistSession;

  const formatHfStatus = useCallback(
    (matched: number, total: number, missing: number) => {
      if (total <= 0) return "No images in dataset yet";
      if (missing > 0) {
        return `${matched}/${total} on Hugging Face · ${missing} still missing — retry HF sync or check Railway HF_DATASET_REPO`;
      }
      return `${matched}/${total} images on Hugging Face`;
    },
    []
  );

  const completeUploadSession = useCallback(
    async (summary?: PersistedUploadSummary | null) => {
      setPhase("done");
      persistSessionRef.current({
        status: "completed",
        progress: 100,
        summary: summary ?? undefined,
        processing: false,
      });
      await clearUploadSession(projectId, datasetId);
      setRestoredSession(null);
      setQueue([]);
      await revalidateProject(projectId);
      router.refresh();
    },
    [projectId, datasetId, router]
  );

  const runHfFinalize = useCallback(
    async (options?: { force?: boolean; waitForBackground?: boolean }) => {
      if (hfSyncTaskRef.current && !options?.force) {
        return hfSyncTaskRef.current;
      }

      const task = (async () => {
        setPhase("hf_syncing");
        setError(null);
        setHfStatus("Checking Hugging Face…");
        persistSessionRef.current({ status: "hf_syncing" });

        try {
          const check = await syncDatasetToHf(projectId, datasetId, {
            waitForBackground: options?.waitForBackground,
            onStatus: (message) => setHfStatus(message),
          });
          setHfStatus(
            formatHfStatus(
              check.matchedByFilename,
              check.dbImagesCount,
              check.missingRemote
            )
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "HF sync failed";
          setHfStatus(message);
          setError(message);
          throw err;
        }
      })();

      hfSyncTaskRef.current = task;
      try {
        await task;
      } finally {
        if (hfSyncTaskRef.current === task) {
          hfSyncTaskRef.current = null;
        }
      }
    },
    [projectId, datasetId, formatHfStatus]
  );

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
        setPreparing(true);
        await saveUploadFiles(projectId, datasetId, files);
        setPreparing(false);
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
      setUploadSummary(normalizeUploadSummary(summary));
      setProcessing(queuedBackgroundUpload);
      persistSession({
        status: "hf_syncing",
        progress: 100,
        summary: normalizeUploadSummary(summary) ?? undefined,
        processing: queuedBackgroundUpload,
        completedFiles: files.length,
        completedBatches: batches.length,
      });

      await runHfFinalize({ waitForBackground: queuedBackgroundUpload });

      await completeUploadSession(normalizeUploadSummary(summary));
    },
    [projectId, datasetId, persistSession, restoredSession, completeUploadSession, runHfFinalize]
  );

  useEffect(() => {
    sessionRestoreRef.current = false;
  }, [projectId, datasetId]);

  useEffect(() => {
    if (sessionRestoreRef.current) return;
    sessionRestoreRef.current = true;

    let cancelled = false;

    (async () => {
      const saved = loadUploadSession(projectId, datasetId);
      if (!saved || cancelled) return;

      if (saved.status === "completed") {
        await clearUploadSession(projectId, datasetId);
        return;
      }

      setRestoredSession(saved);
      setUploadSummary(normalizeUploadSummary(saved.summary));
      setProgress(saved.progress);
      setProcessing(Boolean(saved.processing));

      const uploadComplete =
        saved.completedBatches >= saved.totalBatches &&
        saved.completedFiles >= saved.totalFiles &&
        saved.totalFiles > 0;

      if (saved.status === "paused") {
        setPhase("paused");
        setError(saved.error ?? "Upload paused — tap Resume to continue");
        return;
      }

      if (saved.status === "uploading") {
        if (uploadComplete) {
          setPhase("hf_syncing");
          setHfStatus("Finishing Hugging Face sync…");
          try {
            await runHfFinalize({ waitForBackground: Boolean(saved.processing) });
            if (!cancelled) {
              await completeUploadSession(normalizeUploadSummary(saved.summary));
            }
          } catch {
            if (!cancelled) {
              setPhase("hf_syncing");
            }
          }
          return;
        }
        setPhase("paused");
        setError("Upload paused — tap Resume to continue");
        return;
      }

      if (saved.status === "hf_syncing") {
        setPhase("hf_syncing");
        setHfStatus("Finishing Hugging Face sync…");
        try {
          await runHfFinalize({ waitForBackground: Boolean(saved.processing) });
          if (!cancelled) {
            await completeUploadSession(normalizeUploadSummary(saved.summary));
          }
        } catch {
          if (!cancelled) {
            setPhase("hf_syncing");
          }
        }
        return;
      }

      if (saved.status === "failed") {
        setPhase("paused");
        setError(saved.error ?? "Upload failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, datasetId, runHfFinalize, completeUploadSession]);

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
    const files = queue.map((q) => q.file);
    setPhase("uploading");
    setProgress(0);
    setError(null);
    setHfStatus(null);
    setRestoredSession({
      projectId,
      datasetId,
      datasetName,
      workerSessionId: "",
      status: "uploading",
      totalFiles: files.length,
      completedFiles: 0,
      completedBatches: 0,
      totalBatches: buildUploadBatches(files).length,
      progress: 0,
      fileNames: files.map((f) => f.name),
      updatedAt: Date.now(),
    });
    await runUpload(files);
  }

  function handlePause() {
    abortRef.current?.abort();
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
    await runHfFinalize({ force: true, waitForBackground: processing });
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

  if (uploading || paused) {
    const total = restoredSession?.totalFiles ?? queue.length;
    const completed = restoredSession?.completedFiles ?? 0;

    return (
      <div className="relative pb-28">
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
                  : preparing
                    ? "Preparing upload"
                    : "Uploading images"}
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              {phase === "hf_syncing"
                ? hfStatus ?? "Pushing files to your HF dataset repo…"
                : preparing
                  ? `Saving ${total} file${total !== 1 ? "s" : ""} locally before upload…`
                  : `${completed} of ${total} files sent to server · ${progress}%`}
            </p>

            {phase !== "hf_syncing" && (
              <div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${Math.max(progress, preparing ? 5 : 2)}%` }}
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

            <p className="mt-4 text-xs text-slate-500">
              Progress is saved if you reload. Use Resume to continue a paused upload.
            </p>
          </div>
        </Card>

        <div className="fixed bottom-6 left-1/2 z-50 flex w-[min(100%,40rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          {paused && (
            <Button onClick={handleResume}>
              <Play className="h-4 w-4" />
              Resume
            </Button>
          )}
          {uploading && !preparing && (
            <Button variant="secondary" onClick={handlePause}>
              <PauseCircle className="h-4 w-4" />
              Pause
            </Button>
          )}
          {(paused || phase === "hf_syncing") && (
            <Button variant="secondary" onClick={handleRetryHf}>
              <CloudUpload className="h-4 w-4" />
              Retry HF sync
            </Button>
          )}
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative space-y-6 pb-6">
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

            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={handleUpload} loading={uploading || preparing}>
                {uploading || preparing
                  ? "Uploading…"
                  : `Upload ${queue.length} file${queue.length !== 1 ? "s" : ""}`}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setQueue([])}
                disabled={uploading || preparing}
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
