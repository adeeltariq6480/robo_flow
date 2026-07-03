"use client";

/**
 * Browser → FastAPI multipart uploads. Files go to Hugging Face Hub;
 * metadata is stored in Supabase Postgres via the worker.
 */

import { API_BASE_URL } from "@/lib/api/client";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  timeoutMs = UPLOAD_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    xhr.timeout = timeoutMs;

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
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
        const body = JSON.parse(xhr.responseText);
        if (typeof body?.detail === "string") message = body.detail;
      } catch {
        /* keep default */
      }
      if (xhr.status === 404 && path.includes("upload-model")) {
        message =
          "Worker update pending — redeploy Railway backend, then retry. " +
          "(Missing chunked upload API on server.)";
      }
      reject(new Error(message));
    };

    xhr.onerror = () =>
      reject(
        new Error(
          "Connection lost while uploading — batch may be too large or the server timed out."
        )
      );

    xhr.ontimeout = () =>
      reject(new Error("Upload timed out — retrying with a smaller batch."));

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
}

function emptyResult(): UploadImagesResult {
  return { uploaded: 0, images: [], skipped: [], adjusted: [] };
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

function uploadImagesBatch(
  projectId: string,
  datasetId: string,
  files: File[],
  uploadSessionId: string,
  finalizeSession: boolean,
  onProgress?: (percent: number) => void
): Promise<UploadImagesResult> {
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("dataset_id", datasetId);
  form.append("upload_session_id", uploadSessionId);
  form.append("finalize_session", String(finalizeSession));
  for (const f of files) form.append("files", f);
  return uploadForm("/api/upload-images", form, onProgress);
}

async function uploadBatchWithRetry(
  projectId: string,
  datasetId: string,
  batch: File[],
  uploadSessionId: string,
  finalizeSession: boolean,
  onProgress?: (percent: number) => void
): Promise<UploadImagesResult> {
  if (batch.length === 0) return emptyResult();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      return await uploadImagesBatch(
        projectId,
        datasetId,
        batch,
        uploadSessionId,
        finalizeSession,
        onProgress
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Upload failed");
      const msg = lastError.message;

      if (isConnectionError(msg) && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        const left = await uploadBatchWithRetry(
          projectId,
          datasetId,
          batch.slice(0, mid),
          uploadSessionId,
          false,
          onProgress
        );
        const right = await uploadBatchWithRetry(
          projectId,
          datasetId,
          batch.slice(mid),
          uploadSessionId,
          finalizeSession,
          onProgress
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
  onProgress?: (percent: number) => void
): Promise<UploadImagesResult> {
  if (files.length === 0) return emptyResult();

  const combined = emptyResult();
  const batches = buildUploadBatches(files);
  const uploadSessionId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let completedFiles = 0;
  const totalFiles = files.length;

  for (let i = 0; i < batches.length; i++) {
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
        : undefined
    );

    mergeResults(combined, result);
    completedFiles += batch.length;
    onProgress?.(Math.min(99, Math.round((completedFiles / totalFiles) * 100)));
  }

  return combined;
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
