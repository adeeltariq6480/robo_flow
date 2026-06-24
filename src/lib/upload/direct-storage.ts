/**
 * Upload files directly to Supabase Storage from the browser.
 * Bypasses Next.js / Vercel request body limits (413 on large models).
 */

function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase is not configured for browser uploads.");
  }

  return { url, key };
}

function objectUploadUrl(bucket: string, filePath: string) {
  const { url } = getConfig();
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return `${url}/storage/v1/object/${bucket}/${encoded}`;
}

export function uploadFileToStorage(
  bucket: "models" | "datasets",
  filePath: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ error?: string }> {
  const { key } = getConfig();
  const uploadUrl = objectUploadUrl(bucket, filePath);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Authorization", `Bearer ${key}`);
    xhr.setRequestHeader("apikey", key);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.addEventListener("progress", (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({});
        return;
      }

      let message = `Upload failed (HTTP ${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as {
          message?: string;
          error?: string;
        };
        message = body.message ?? body.error ?? message;
      } catch {
        /* use default */
      }

      if (xhr.status === 413) {
        message =
          "File is too large for storage. Check Supabase bucket size limit (models bucket allows up to 500 MB).";
      }

      resolve({ error: message });
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.send(file);
  });
}
