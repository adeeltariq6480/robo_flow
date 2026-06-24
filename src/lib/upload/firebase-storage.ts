"use client";

/**
 * Upload files directly to Firebase Storage from the browser.
 * Bypasses Next.js / Vercel request body limits for large YOLO models.
 */

import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { getClientStorage } from "@/lib/firebase/client";

export function uploadFileToFirebaseStorage(
  storagePath: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ downloadUrl?: string; error?: string }> {
  const storage = getClientStorage();
  const storageRef = ref(storage, storagePath);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
  });

  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (onProgress && snapshot.totalBytes > 0) {
          onProgress(
            Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          );
        }
      },
      (error) => {
        resolve({ error: error.message });
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(task.snapshot.ref);
          resolve({ downloadUrl });
        } catch (e) {
          resolve({
            error: e instanceof Error ? e.message : "Failed to get download URL",
          });
        }
      }
    );

    task.catch(reject);
  });
}

/** @deprecated Use uploadFileToFirebaseStorage — kept for upload form compatibility */
export function uploadFileToStorage(
  _bucket: "models" | "datasets",
  filePath: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ error?: string; downloadUrl?: string }> {
  return uploadFileToFirebaseStorage(filePath, file, onProgress);
}
