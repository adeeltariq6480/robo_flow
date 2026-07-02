"use client";

/**
 * Browser → FastAPI multipart uploads. Files are sent to the backend, which
 * stores them in Hugging Face Hub and records metadata in Firestore.
 * No secrets are used here — only the public backend URL.
 */

import { API_BASE_URL } from "@/lib/api/client";

/** Images per request — keeps payloads small and avoids proxy timeouts. */
const UPLOAD_BATCH_SIZE = 15;
const UPLOAD_MAX_RETRIES = 2;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

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
          "Upload failed — connection error. If you see CORS in the console, the request may be too large or timed out. Images are uploaded in small batches automatically; retry or check Railway CORS_ORIGINS includes your site URL."
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

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
      try {
        const result = await uploadImagesBatch(
          projectId,
          datasetId,
          batch,
          (batchPct) => {
            if (!onProgress) return;
            const overall = ((i + batchPct / 100) / batches.length) * 100;
            onProgress(Math.min(99, Math.round(overall)));
          }
        );

        combined.uploaded += result.uploaded;
        combined.images.push(...(result.images ?? []));
        combined.skipped!.push(...(result.skipped ?? []));
        combined.adjusted!.push(...(result.adjusted ?? []));
        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error("Upload failed");
        if (attempt < UPLOAD_MAX_RETRIES) {
          await sleep(1200 * (attempt + 1));
        }
      }
    }

    if (lastError) throw lastError;
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
