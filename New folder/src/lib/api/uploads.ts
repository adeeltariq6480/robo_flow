"use client";

/**
 * Browser → FastAPI multipart uploads. Files are sent to the backend, which
 * stores them in Hugging Face Hub and records metadata in Firestore.
 * No secrets are used here — only the public backend URL.
 */

import { API_BASE_URL } from "@/lib/api/client";

function uploadForm<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);

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
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (typeof body?.detail === "string") message = body.detail;
        } catch {
          /* keep default */
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () =>
      reject(new Error("Network error — is the backend running?"));
    xhr.send(form);
  });
}

export interface UploadedImage {
  id: string;
  fileName: string;
  hfPath?: string | null;
}

export function uploadImages(
  projectId: string,
  datasetId: string,
  files: File[],
  onProgress?: (percent: number) => void
): Promise<{ uploaded: number; images: UploadedImage[] }> {
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("dataset_id", datasetId);
  for (const f of files) form.append("files", f);
  return uploadForm("/api/upload-images", form, onProgress);
}

export function uploadZip(
  projectId: string,
  datasetId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ uploaded: number; images: UploadedImage[] }> {
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
