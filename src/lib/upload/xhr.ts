export interface XhrUploadResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export function uploadWithProgress<T = unknown>(
  url: string,
  formData: FormData,
  onProgress: (percent: number) => void
): Promise<XhrUploadResult<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      const data = (xhr.response ?? {}) as T;
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"));
    });

    xhr.send(formData);
  });
}
