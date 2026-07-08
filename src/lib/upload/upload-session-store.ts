"use client";

import type { UploadImagesResult } from "@/lib/api/uploads";

const DB_NAME = "robo-flow-uploads";
const DB_VERSION = 1;
const FILES_STORE = "files";
const SESSION_KEY_PREFIX = "robo_flow_upload_session";

export type UploadSessionStatus =
  | "uploading"
  | "paused"
  | "hf_syncing"
  | "completed"
  | "failed";

export interface PersistedUploadSummary {
  uploaded: number;
  skipped: UploadImagesResult["skipped"];
  adjusted: UploadImagesResult["adjusted"];
}

export interface PersistedUploadSession {
  projectId: string;
  datasetId: string;
  datasetName: string;
  workerSessionId: string;
  status: UploadSessionStatus;
  totalFiles: number;
  completedFiles: number;
  completedBatches: number;
  totalBatches: number;
  progress: number;
  fileNames: string[];
  error?: string;
  summary?: PersistedUploadSummary;
  processing?: boolean;
  updatedAt: number;
}

function sessionStorageKey(projectId: string, datasetId: string) {
  return `${SESSION_KEY_PREFIX}:${projectId}:${datasetId}`;
}

function filesPrefix(projectId: string, datasetId: string) {
  return `${projectId}:${datasetId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveUploadFiles(
  projectId: string,
  datasetId: string,
  files: File[]
): Promise<void> {
  const db = await openDb();
  const prefix = filesPrefix(projectId, datasetId);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, "readwrite");
    const store = tx.objectStore(FILES_STORE);
    for (let i = 0; i < files.length; i++) {
      store.put(
        {
          name: files[i].name,
          type: files[i].type,
          lastModified: files[i].lastModified,
          blob: files[i],
        },
        `${prefix}:${i}`
      );
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save upload files"));
  });
  db.close();
}

export async function loadUploadFiles(
  projectId: string,
  datasetId: string
): Promise<File[]> {
  const db = await openDb();
  const prefix = filesPrefix(projectId, datasetId);
  const files: File[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, "readonly");
    const store = tx.objectStore(FILES_STORE);
    const request = store.getAllKeys();
    request.onsuccess = () => {
      const keys = (request.result as IDBValidKey[])
        .map(String)
        .filter((key) => key.startsWith(`${prefix}:`))
        .sort((a, b) => {
          const ai = Number(a.split(":").pop() ?? "0");
          const bi = Number(b.split(":").pop() ?? "0");
          return ai - bi;
        });

      if (keys.length === 0) {
        resolve();
        return;
      }

      let pending = keys.length;
      for (const key of keys) {
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          const row = getReq.result as
            | { name: string; type: string; lastModified: number; blob: Blob }
            | undefined;
          if (row?.blob) {
            files.push(
              new File([row.blob], row.name, {
                type: row.type,
                lastModified: row.lastModified,
              })
            );
          }
          pending -= 1;
          if (pending === 0) resolve();
        };
        getReq.onerror = () => reject(getReq.error ?? new Error("Failed to read file"));
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to list files"));
  });

  db.close();
  return files;
}

export async function clearUploadFiles(
  projectId: string,
  datasetId: string
): Promise<void> {
  const db = await openDb();
  const prefix = filesPrefix(projectId, datasetId);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, "readwrite");
    const store = tx.objectStore(FILES_STORE);
    const request = store.getAllKeys();
    request.onsuccess = () => {
      const keys = (request.result as IDBValidKey[])
        .map(String)
        .filter((key) => key.startsWith(`${prefix}:`));
      for (const key of keys) store.delete(key);
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to clear files"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear files"));
  });
  db.close();
}

export function loadUploadSession(
  projectId: string,
  datasetId: string
): PersistedUploadSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(sessionStorageKey(projectId, datasetId));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedUploadSession;
  } catch {
    return null;
  }
}

export function saveUploadSession(session: PersistedUploadSession) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    sessionStorageKey(session.projectId, session.datasetId),
    JSON.stringify({ ...session, updatedAt: Date.now() })
  );
}

export async function clearUploadSession(projectId: string, datasetId: string) {
  if (typeof window !== "undefined") {
    localStorage.removeItem(sessionStorageKey(projectId, datasetId));
  }
  await clearUploadFiles(projectId, datasetId);
}
