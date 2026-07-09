"use client";

/**
 * Browser → FastAPI multipart uploads. Files go to Hugging Face Hub;
 * metadata is stored in Supabase Postgres via the worker.
 */

import { API_BASE_URL } from "@/lib/api/client";

/** Optional — only if Railway WORKER_API_KEY is set (same value on Vercel). */
const BROWSER_WORKER_API_KEY =
  process.env.NEXT_PUBLIC_WORKER_API_KEY ?? "";

/** Small models: single request to worker. Larger: chunked upload → HF. */
const MODEL_WORKER_MAX_BYTES = 25 * 1024 * 1024;
const MODEL_CHUNK_SIZE = 8 * 1024 * 1024;

/** Stay under Railway/proxy body limits (~15–25 MB per request). */
const MAX_BATCH_BYTES = 15 * 1024 * 1024;
/** Cap files per request even when images are small. */
const MAX_BATCH_FILES = 20;
const UPLOAD_MAX_RETRIES = 2;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
/** YOLO .pt files can be large — allow longer worker upload time. */
const MODEL_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

function workerFetchHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  if (BROWSER_WORKER_API_KEY) {
    headers["X-Worker-Key"] = BROWSER_WORKER_API_KEY;
  }
  return headers;
}

async function workerJsonFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = UPLOAD_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...workerFetchHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const raw = await res.text();
      let message = `Request failed (${res.status})`;
      try {
        const body = JSON.parse(raw) as { detail?: string };
        if (body.detail) message = body.detail;
      } catch {
        if (raw) message = raw.slice(0, 300);
      }
      if (res.status === 401) {
        message =
          "Worker rejected API key (401). Remove WORKER_API_KEY on Railway, or set the same value as NEXT_PUBLIC_WORKER_API_KEY on Vercel.";
      }
      throw new Error(message);
    }
    const raw = await res.text();
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out — try again in a moment.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Size-aware batches: fewer commits than 1-by-1, small enough to avoid timeouts. */
export function buildUploadBatches(files: File[]): File[][] {
  const batches: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;

  for (const file of files) {
    const wouldOverflow =
      current.length > 0 &&
      (current.length >= MAX_BATCH_FILES ||
        currentBytes + file.size > MAX_BATCH_BYTES);

    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(file);
    currentBytes += file.size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function isConnectionError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("connection error") ||
    m.includes("network error") ||
    m.includes("timed out") ||
    m.includes("failed to fetch") ||
    m.includes("cors")
  );
}

function isRateLimitError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("too many requests")
  );
}

function uploadForm<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
  timeoutMs = UPLOAD_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    if (BROWSER_WORKER_API_KEY) {
      xhr.setRequestHeader("X-Worker-Key", BROWSER_WORKER_API_KEY);
    }
    xhr.timeout = timeoutMs;

    const onAbort = () => {
      xhr.abort();
    };
    signal?.addEventListener("abort", onAbort);

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(xhr.responseText ? JSON.parse(xhr.responseText) : ({} as T));
        } catch {
          resolve({} as T);
        }
        return;
      }

      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as { detail?: string };
        if (typeof body?.detail === "string") message = body.detail;
        if (xhr.status === 401) {
          message =
            "Worker rejected API key (401). Remove WORKER_API_KEY on Railway, or set the same value as NEXT_PUBLIC_WORKER_API_KEY on Vercel.";
        }
        if (xhr.status === 507) {
          message = `${message} Check Railway volume is mounted at /data.`;
        }
      } catch {
        if (xhr.status === 401) {
          message =
            "Worker rejected API key (401). Remove WORKER_API_KEY on Railway, or set the same value as NEXT_PUBLIC_WORKER_API_KEY on Vercel.";
        }
      }
      if (xhr.status === 404 && path.includes("upload-model")) {
        message =
          "Worker update pending — redeploy Railway backend, then retry. " +
          "(Missing chunked upload API on server.)";
      }
      reject(new Error(message));
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(
        new Error(
          "Connection lost while uploading — batch may be too large or the server timed out."
        )
      );
    };

    xhr.ontimeout = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Upload timed out — retrying with a smaller batch."));
    };

    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Upload cancelled"));
    };

    xhr.send(form);
  });
}

export interface UploadedImage {
  id: string;
  fileName: string;
  hfPath?: string | null;
}

export interface UploadSkipInfo {
  fileName: string;
  reason: string;
  message?: string;
}

export interface UploadAdjustInfo {
  fileName: string;
  reason: string;
  message?: string;
}

export interface UploadImagesResult {
  uploaded: number;
  images: UploadedImage[];
  skipped?: UploadSkipInfo[];
  adjusted?: UploadAdjustInfo[];
  processing?: boolean;
}

function emptyResult(): UploadImagesResult {
  return { uploaded: 0, images: [], skipped: [], adjusted: [], processing: false };
}

function mergeResults(
  target: UploadImagesResult,
  source: UploadImagesResult
): UploadImagesResult {
  target.uploaded += source.uploaded;
  target.images.push(...(source.images ?? []));
  target.skipped!.push(...(source.skipped ?? []));
  target.adjusted!.push(...(source.adjusted ?? []));
  return target;
}

export interface UploadImagesOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  uploadSessionId?: string;
  startBatchIndex?: number;
  onWorkerSessionId?: (sessionId: string) => void;
  onBatchComplete?: (batchIndex: number, completedFiles: number) => void;
}

function uploadImagesBatch(
  projectId: string,
  datasetId: string,
  files: File[],
  uploadSessionId: string,
  finalizeSession: boolean,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<UploadImagesResult> {
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("dataset_id", datasetId);
  form.append("upload_session_id", uploadSessionId);
  form.append("finalize_session", String(finalizeSession));
  for (const f of files) form.append("files", f);
  return uploadForm("/api/upload-images", form, onProgress, UPLOAD_TIMEOUT_MS, signal);
}

async function uploadBatchWithRetry(
  projectId: string,
  datasetId: string,
  batch: File[],
  uploadSessionId: string,
  finalizeSession: boolean,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<UploadImagesResult> {
  if (batch.length === 0) return emptyResult();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error("Upload cancelled");
    }
    try {
      return await uploadImagesBatch(
        projectId,
        datasetId,
        batch,
        uploadSessionId,
        finalizeSession,
        onProgress,
        signal
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Upload failed");
      if (lastError.message === "Upload cancelled") throw lastError;
      const msg = lastError.message;

      if (isConnectionError(msg) && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        const left = await uploadBatchWithRetry(
          projectId,
          datasetId,
          batch.slice(0, mid),
          uploadSessionId,
          false,
          onProgress,
          signal
        );
        const right = await uploadBatchWithRetry(
          projectId,
          datasetId,
          batch.slice(mid),
          uploadSessionId,
          finalizeSession,
          onProgress,
          signal
        );
        return mergeResults(left, right);
      }

      if (attempt < UPLOAD_MAX_RETRIES) {
        await sleep(isRateLimitError(msg) ? 90_000 : 1500 * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError ?? new Error("Upload failed");
}

export async function uploadImages(
  projectId: string,
  datasetId: string,
  files: File[],
  options: UploadImagesOptions = {}
): Promise<UploadImagesResult> {
  if (files.length === 0) return emptyResult();

  const {
    onProgress,
    signal,
    uploadSessionId: existingSessionId,
    startBatchIndex = 0,
    onWorkerSessionId,
    onBatchComplete,
  } = options;

  const combined = emptyResult();
  const batches = buildUploadBatches(files);
  const uploadSessionId =
    existingSessionId ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  onWorkerSessionId?.(uploadSessionId);

  let completedFiles = batches
    .slice(0, startBatchIndex)
    .reduce((sum, batch) => sum + batch.length, 0);
  const totalFiles = files.length;

  for (let i = startBatchIndex; i < batches.length; i++) {
    if (signal?.aborted) {
      throw new Error("Upload cancelled");
    }
    const batch = batches[i];
    const batchStart = completedFiles;

    const result = await uploadBatchWithRetry(
      projectId,
      datasetId,
      batch,
      uploadSessionId,
      i === batches.length - 1,
      onProgress
        ? (pct) => {
            const doneInBatch = (pct / 100) * batch.length;
            const overall = ((batchStart + doneInBatch) / totalFiles) * 100;
            onProgress(Math.min(99, Math.round(overall)));
          }
        : undefined,
      signal
    );

    mergeResults(combined, result);
    completedFiles += batch.length;
    onBatchComplete?.(i + 1, completedFiles);
    onProgress?.(Math.min(99, Math.round((completedFiles / totalFiles) * 100)));
  }

  return combined;
}

export interface DatasetSyncPreview {
  localImagesCount: number;
  pendingImageSync: number;
  imagesSynced: boolean;
}

export async function getDatasetSyncPreview(
  projectId: string,
  datasetId: string
): Promise<DatasetSyncPreview> {
  const data = await workerJsonFetch<
    DatasetSyncPreview & {
      local_images_count?: number;
      pending_image_sync?: number;
      images_synced?: boolean;
    }
  >(`/api/datasets/${projectId}/${datasetId}/sync-preview`);
  return {
    localImagesCount: data.localImagesCount ?? data.local_images_count ?? 0,
    pendingImageSync: data.pendingImageSync ?? data.pending_image_sync ?? 0,
    imagesSynced: data.imagesSynced ?? data.images_synced ?? false,
  };
}

export async function waitForDatasetBackgroundSync(
  projectId: string,
  datasetId: string,
  options?: { maxWaitMs?: number; pollMs?: number }
): Promise<void> {
  const maxWaitMs = options?.maxWaitMs ?? 2 * 60 * 1000;
  let pollMs = options?.pollMs ?? 8000;
  const started = Date.now();
  let consecutiveErrors = 0;

  while (Date.now() - started < maxWaitMs) {
    try {
      const preview = await getDatasetSyncPreview(projectId, datasetId);
      consecutiveErrors = 0;
      if (preview.imagesSynced || preview.pendingImageSync === 0) {
        return;
      }
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) {
        throw new Error(
          "Worker is busy or unreachable while waiting for background HF sync — retry HF sync in a moment."
        );
      }
      pollMs = Math.min(pollMs * 2, 20000);
    }
    await sleep(pollMs);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface HfFileCheckResult {
  dbImagesCount: number;
  remoteFilesCount: number;
  matchedByFilename: number;
  missingRemote: number;
}

export async function finalizeDatasetHfUpload(
  projectId: string,
  datasetId: string
): Promise<{ ok?: boolean; count?: number; message?: string }> {
  return workerJsonFetch(
    `/api/datasets/${projectId}/${datasetId}/finalize-upload`,
    { method: "POST" },
    UPLOAD_TIMEOUT_MS
  );
}

export async function checkDatasetHfFiles(
  projectId: string,
  datasetId: string
): Promise<HfFileCheckResult> {
  const data = await workerJsonFetch<
    HfFileCheckResult & {
      db_images_count?: number;
      remote_files_count?: number;
      hf_files_found?: number;
      matched_by_filename?: number;
      missing_remote?: number;
    }
  >(`/api/admin/datasets/${projectId}/${datasetId}/hf-file-check`);
  return {
    dbImagesCount: data.dbImagesCount ?? data.db_images_count ?? 0,
    remoteFilesCount:
      data.remoteFilesCount ?? data.remote_files_count ?? data.hf_files_found ?? 0,
    matchedByFilename: data.matchedByFilename ?? data.matched_by_filename ?? 0,
    missingRemote: data.missingRemote ?? data.missing_remote ?? 0,
  };
}

export interface SyncDatasetHfOptions {
  waitForBackground?: boolean;
  onStatus?: (message: string) => void;
}

/** Check HF first; only call finalize-upload when files are still missing. */
export async function syncDatasetToHf(
  projectId: string,
  datasetId: string,
  options: SyncDatasetHfOptions = {}
): Promise<HfFileCheckResult> {
  const report = (message: string) => options.onStatus?.(message);

  if (options.waitForBackground) {
    report("Waiting for worker to finish background upload…");
    await waitForDatasetBackgroundSync(projectId, datasetId);
  }

  report("Checking Hugging Face…");
  let check = await checkDatasetHfFiles(projectId, datasetId);
  const alreadySynced =
    check.dbImagesCount > 0 &&
    check.matchedByFilename >= check.dbImagesCount &&
    check.missingRemote === 0;

  if (!alreadySynced && check.missingRemote === 0 && check.matchedByFilename === 0) {
    // DB may still be catching up — one short wait before finalize.
    report("Waiting for worker background sync…");
    try {
      await waitForDatasetBackgroundSync(projectId, datasetId, {
        maxWaitMs: 45_000,
        pollMs: 10_000,
      });
      check = await checkDatasetHfFiles(projectId, datasetId);
    } catch {
      // Continue to finalize attempt below.
    }
  }

  const syncedAfterWait =
    check.dbImagesCount > 0 &&
    check.matchedByFilename >= check.dbImagesCount &&
    check.missingRemote === 0;

  if (!syncedAfterWait) {
    report("Pushing remaining images to Hugging Face…");
    const result = await finalizeDatasetHfUpload(projectId, datasetId);
    if (result.message) {
      report(result.message);
    }
    check = await checkDatasetHfFiles(projectId, datasetId);
  }

  return check;
}

export function uploadZip(
  projectId: string,
  datasetId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadImagesResult> {
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("dataset_id", datasetId);
  form.append("file", file);
  return uploadForm("/api/upload-zip", form, onProgress);
}

async function uploadModelChunked(
  projectId: string,
  data: {
    file: File;
    modelName: string;
    modelVersion: string;
    modelType: string;
    description?: string;
  },
  onProgress?: (percent: number) => void
): Promise<{ id: string; modelName: string }> {
  const totalChunks = Math.ceil(data.file.size / MODEL_CHUNK_SIZE);
  const initForm = new FormData();
  initForm.append("project_id", projectId);
  initForm.append("file_name", data.file.name);
  initForm.append("total_chunks", String(totalChunks));
  initForm.append("file_size", String(data.file.size));
  initForm.append("model_name", data.modelName);
  initForm.append("model_version", data.modelVersion);
  initForm.append("model_type", data.modelType);
  initForm.append("description", data.description ?? "");

  const { sessionId } = await uploadForm<{ sessionId: string }>(
    "/api/upload-model/init",
    initForm,
    undefined,
    MODEL_UPLOAD_TIMEOUT_MS
  );

  for (let i = 0; i < totalChunks; i++) {
    const start = i * MODEL_CHUNK_SIZE;
    const end = Math.min(start + MODEL_CHUNK_SIZE, data.file.size);
    const blob = data.file.slice(start, end);
    const chunkForm = new FormData();
    chunkForm.append("session_id", sessionId);
    chunkForm.append("chunk_index", String(i));
    chunkForm.append("chunk", blob, data.file.name);

    await uploadForm(
      "/api/upload-model/chunk",
      chunkForm,
      onProgress
        ? (pct) => {
            const overall = ((i + pct / 100) / totalChunks) * 95;
            onProgress(Math.round(overall));
          }
        : undefined,
      MODEL_UPLOAD_TIMEOUT_MS
    );
  }

  const finishForm = new FormData();
  finishForm.append("session_id", sessionId);
  const model = await uploadForm<{ id: string; modelName: string }>(
    "/api/upload-model/finish",
    finishForm,
    onProgress ? () => onProgress(99) : undefined,
    MODEL_UPLOAD_TIMEOUT_MS
  );
  onProgress?.(100);
  return model;
}

export async function uploadModel(
  projectId: string,
  data: {
    file: File;
    modelName: string;
    modelVersion: string;
    modelType: string;
    description?: string;
  },
  onProgress?: (percent: number) => void
): Promise<{ id: string; modelName: string }> {
  if (data.file.size <= MODEL_WORKER_MAX_BYTES) {
    const form = new FormData();
    form.append("project_id", projectId);
    form.append("model_name", data.modelName);
    form.append("model_version", data.modelVersion);
    form.append("model_type", data.modelType);
    form.append("description", data.description ?? "");
    form.append("file", data.file);
    return uploadForm(
      "/api/upload-model",
      form,
      onProgress,
      MODEL_UPLOAD_TIMEOUT_MS
    );
  }

  return uploadModelChunked(projectId, data, onProgress);
}
