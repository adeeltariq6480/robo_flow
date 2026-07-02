import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

const MODEL_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Upload a large file directly to Supabase Storage (bypasses Railway body limits).
 * Uses the Storage REST API with XHR for upload progress.
 */
export function uploadFileToSupabaseStorage(
  bucket: string,
  objectPath: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  const baseUrl = getSupabaseUrl();
  const apiKey = getSupabaseAnonKey();
  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${baseUrl}/storage/v1/object/${bucket}/${encodedPath}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = MODEL_UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Authorization", `Bearer ${apiKey}`);
    xhr.setRequestHeader("apikey", apiKey);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );
    xhr.setRequestHeader("x-upsert", "true");

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = `Storage upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as {
          message?: string;
          error?: string;
        };
        message = body.message || body.error || message;
      } catch {
        /* keep default */
      }
      reject(new Error(message));
    };

    xhr.onerror = () =>
      reject(
        new Error(
          "Connection lost while uploading to storage. Check your network or try a smaller file."
        )
      );

    xhr.ontimeout = () =>
      reject(new Error("Model upload timed out — try again on a faster connection."));

    xhr.send(file);
  });
}

export function modelStoragePath(projectId: string, fileName: string): string {
  const safe = fileName.replace(/\\/g, "/").split("/").pop() || "model.pt";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  return `${projectId}/${id}-${safe}`;
}
