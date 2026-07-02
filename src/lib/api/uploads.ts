"use client";

/**
 * Browser → FastAPI multipart uploads. Files are sent to the backend, which
 * stores them in Hugging Face Hub and records metadata in Firestore.
 * No secrets are used here — only the public backend URL.
 */

import { API_BASE_URL } from "@/lib/api/client";

/** Images per HTTP request. */
const UPLOAD_BATCH_SIZE = 25;
/** Parallel upload requests from the browser. */
const UPLOAD_CONCURRENCY = 4;
const UPLOAD_MAX_RETRIES = 2;
const UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadForm<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    xhr.timeout = UPLOAD_TIMEOUT_MS;

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
      reject(new Error(message));
    };

    xhr.onerror = () =>
      reject(
        new Error(
          "Upload failed — connection error. If you see CORS in the console, the request may be too large or timed out."
        )
      );

    xhr.ontimeout = () =>
      reject(
        new Error(
          "Upload timed out — try again or upload fewer images at once."
        )
      );

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

function uploadImagesBatch(
  projectId: string,
  datasetId: string,
  files: File[],
  onProgress?: (percent: number) => void
): Promise<UploadImagesResult> {
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("dataset_id", datasetId);
  for (const f of files) form.append("files", f);
  return uploadForm("/api/upload-images", form, onProgress);
}

async function uploadBatchWithRetry(
  projectId: string,
  datasetId: string,
  batch: File[]
): Promise<UploadImagesResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      return await uploadImagesBatch(projectId, datasetId, batch);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Upload failed");
      if (attempt < UPLOAD_MAX_RETRIES) {
        await sleep(800 * (attempt + 1));
      }
    }
  }

  throw lastError ?? new Error("Upload failed");
}

function mergeResults(
  target: UploadImagesResult,
  source: UploadImagesResult
) {
  target.uploaded += source.uploaded;
  target.images.push(...(source.images ?? []));
  target.skipped!.push(...(source.skipped ?? []));
  target.adjusted!.push(...(source.adjusted ?? []));
}

export async function uploadImages(
  projectId: string,
  datasetId: string,
  files: File[],
  onProgress?: (percent: number) => void
): Promise<UploadImagesResult> {
  if (files.length === 0) {
    return { uploaded: 0, images: [], skipped: [], adjusted: [] };
  }

  const combined: UploadImagesResult = {
    uploaded: 0,
    images: [],
    skipped: [],
    adjusted: [],
  };

  const batches = chunk(files, UPLOAD_BATCH_SIZE);
  let nextBatch = 0;
  let completedFiles = 0;
  const totalFiles = files.length;

  const reportProgress = () => {
    if (!onProgress) return;
    onProgress(Math.min(99, Math.round((completedFiles / totalFiles) * 100)));
  };

  async function worker() {
    while (true) {
      const index = nextBatch++;
      if (index >= batches.length) break;

      const batch = batches[index];
      const result = await uploadBatchWithRetry(projectId, datasetId, batch);
      mergeResults(combined, result);
      completedFiles += batch.length;
      reportProgress();
    }
  }

  const workers = Math.min(UPLOAD_CONCURRENCY, batches.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

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

export function uploadModel(
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
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("model_name", data.modelName);
  form.append("model_version", data.modelVersion);
  form.append("model_type", data.modelType);
  form.append("description", data.description ?? "");
  form.append("file", data.file);
  return uploadForm("/api/upload-model", form, onProgress);
}
