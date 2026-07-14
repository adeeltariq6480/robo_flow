"use client";

/**
 * Background CSV image download that survives SPA navigation and page reload.
 * Progress + image blobs persist in IndexedDB; a module-level pump keeps running
 * independent of React components.
 */

import JSZip from "jszip";
import {
  extractImageUrls,
  fileNameFromUrl,
  type StockCsvColumn,
} from "@/lib/stock-csv-download";
import {
  setCsvDownloadStatus,
  touchCsvDownloadStatus,
} from "@/lib/csv-download-status";

const DB_NAME = "axiomai-csv-download";
const DB_VERSION = 1;
const META_STORE = "jobs";
const BLOB_STORE = "files";

export type CsvDownloadProgress = {
  jobId: string;
  done: number;
  total: number;
  failed: number;
  label: string;
  status: "running" | "done" | "error";
};

type JobMeta = {
  id: string;
  column: StockCsvColumn;
  urls: string[];
  nextIndex: number;
  failed: number;
  zipName: string;
  usedNames: string[];
  totalAvailable: number;
  status: "running" | "done" | "error";
  error?: string;
  createdAt: number;
};

let pumping = false;
const listeners = new Set<(p: CsvDownloadProgress) => void>();

export function subscribeCsvDownloadProgress(
  cb: (p: CsvDownloadProgress) => void
): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(p: CsvDownloadProgress) {
  for (const cb of listeners) {
    try {
      cb(p);
    } catch {
      /* ignore */
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: "key" });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

async function putJob(job: JobMeta): Promise<void> {
  const db = await openDb();
  try {
    await idbReq(db.transaction(META_STORE, "readwrite").objectStore(META_STORE).put(job));
  } finally {
    db.close();
  }
}

async function getJob(id: string): Promise<JobMeta | null> {
  const db = await openDb();
  try {
    const row = await idbReq(
      db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(id)
    );
    return (row as JobMeta) ?? null;
  } finally {
    db.close();
  }
}

async function getRunningJobs(): Promise<JobMeta[]> {
  const db = await openDb();
  try {
    const all = (await idbReq(
      db.transaction(META_STORE, "readonly").objectStore(META_STORE).getAll()
    )) as JobMeta[];
    return (all || []).filter((j) => j.status === "running");
  } finally {
    db.close();
  }
}

async function deleteJobData(jobId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(jobId);
    const files = tx.objectStore(BLOB_STORE);
    const all = (await idbReq(files.getAll())) as Array<{ key: string }>;
    for (const row of all || []) {
      if (row.key.startsWith(`${jobId}:`)) files.delete(row.key);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB delete failed"));
    });
  } finally {
    db.close();
  }
}

async function putFile(
  jobId: string,
  name: string,
  bytes: ArrayBuffer
): Promise<void> {
  const db = await openDb();
  try {
    await idbReq(
      db.transaction(BLOB_STORE, "readwrite").objectStore(BLOB_STORE).put({
        key: `${jobId}:${name}`,
        name,
        bytes,
      })
    );
  } finally {
    db.close();
  }
}

async function listFiles(
  jobId: string
): Promise<Array<{ name: string; bytes: ArrayBuffer }>> {
  const db = await openDb();
  try {
    const all = (await idbReq(
      db.transaction(BLOB_STORE, "readonly").objectStore(BLOB_STORE).getAll()
    )) as Array<{ key: string; name: string; bytes: ArrayBuffer }>;
    return (all || [])
      .filter((r) => r.key.startsWith(`${jobId}:`))
      .map((r) => ({ name: r.name, bytes: r.bytes }));
  } finally {
    db.close();
  }
}

function proxyUrl(imageUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}

async function fetchImageBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(proxyUrl(url));
  if (!res.ok) {
    throw new Error(`Failed ${res.status}`);
  }
  return res.arrayBuffer();
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : ".jpg";
  let n = 2;
  while (used.has(`${stem}_${n}${ext}`)) n++;
  const next = `${stem}_${n}${ext}`;
  used.add(next);
  return next;
}

function triggerBrowserDownload(blob: Blob, zipName: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

async function finalizeJob(job: JobMeta): Promise<void> {
  const files = await listFiles(job.id);
  if (files.length === 0) {
    job.status = "error";
    job.error = "Could not download any images.";
    await putJob(job);
    emit({
      jobId: job.id,
      done: job.urls.length,
      total: job.urls.length,
      failed: job.failed,
      label: job.error,
      status: "error",
    });
    setCsvDownloadStatus(false);
    await deleteJobData(job.id);
    return;
  }

  emit({
    jobId: job.id,
    done: job.urls.length,
    total: job.urls.length,
    failed: job.failed,
    label: "Building ZIP…",
    status: "running",
  });
  touchCsvDownloadStatus("Building ZIP…");

  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  const blob = await zip.generateAsync({ type: "blob" });
  triggerBrowserDownload(blob, job.zipName);

  job.status = "done";
  await putJob(job);

  const label = `Download complete — ${files.length} image(s)` +
    (job.failed ? `, ${job.failed} failed` : "");
  emit({
    jobId: job.id,
    done: job.urls.length,
    total: job.urls.length,
    failed: job.failed,
    label,
    status: "done",
  });

  // Keep brief success, then clear
  setCsvDownloadStatus(true, label);
  setTimeout(() => setCsvDownloadStatus(false), 4000);
  await deleteJobData(job.id);
}

async function pumpJob(jobId: string): Promise<void> {
  const concurrency = 4;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = await getJob(jobId);
    if (!job || job.status !== "running") return;

    if (job.nextIndex >= job.urls.length) {
      await finalizeJob(job);
      return;
    }

    const used = new Set(job.usedNames);
    const start = job.nextIndex;
    const end = Math.min(start + concurrency, job.urls.length);
    const batchUrls = job.urls.slice(start, end);

    const results = await Promise.all(
      batchUrls.map(async (url, batchIdx) => {
        const index = start + batchIdx;
        const name = uniqueName(fileNameFromUrl(url, index), used);
        try {
          const bytes = await fetchImageBytes(url);
          await putFile(jobId, name, bytes);
          return { ok: true as const, name };
        } catch {
          return { ok: false as const, name };
        }
      })
    );

    // Re-read in case another tab advanced (rare)
    const latest = (await getJob(jobId)) ?? job;
    if (latest.status !== "running") return;

    let failedAdd = 0;
    for (const r of results) {
      if (!r.ok) failedAdd += 1;
      if (!latest.usedNames.includes(r.name)) latest.usedNames.push(r.name);
    }
    latest.nextIndex = end;
    latest.failed += failedAdd;
    await putJob(latest);

    const label = `Downloading images ${latest.nextIndex} / ${latest.urls.length}… (background)`;
    emit({
      jobId,
      done: latest.nextIndex,
      total: latest.urls.length,
      failed: latest.failed,
      label,
      status: "running",
    });
    touchCsvDownloadStatus(label);
  }
}

async function pumpAll(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const running = await getRunningJobs();
      if (running.length === 0) break;
      await pumpJob(running[0].id);
    }
  } finally {
    pumping = false;
  }
}

/**
 * Start a download job that keeps going if you leave the page / reload.
 * Images are cached in IndexedDB until the ZIP is ready.
 */
export async function startStockCsvDownloadJob(
  csvFile: File,
  column: StockCsvColumn,
  options: { limit?: number } = {}
): Promise<{ jobId: string; total: number; totalAvailable: number }> {
  const existing = await getRunningJobs();
  if (existing.length > 0) {
    throw new Error(
      "Pehle wala download abhi chal raha hai — complete hone do."
    );
  }

  const text = await csvFile.text();
  const { urls, columnLabel, totalAvailable } = extractImageUrls(
    text,
    column,
    options.limit ?? 0
  );
  if (urls.length === 0) {
    throw new Error(`No image URLs found in "${columnLabel}".`);
  }

  const jobId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `job-${Date.now()}`;

  const zipName = `stock_${column}_images_${new Date()
    .toISOString()
    .slice(0, 10)}.zip`;

  const job: JobMeta = {
    id: jobId,
    column,
    urls,
    nextIndex: 0,
    failed: 0,
    zipName,
    usedNames: [],
    totalAvailable,
    status: "running",
    createdAt: Date.now(),
  };
  await putJob(job);

  const label = `Downloading ${urls.length} of ${totalAvailable} ${columnLabel} (background — page leave OK)…`;
  setCsvDownloadStatus(true, label);
  emit({
    jobId,
    done: 0,
    total: urls.length,
    failed: 0,
    label,
    status: "running",
  });

  void pumpAll();
  return { jobId, total: urls.length, totalAvailable };
}

/** Call once on app mount (sidebar) — resume after reload. */
export function resumeStockCsvDownloads(): void {
  void (async () => {
    try {
      const running = await getRunningJobs();
      if (running.length === 0) return;
      const job = running[0];
      const label = `Resuming download ${job.nextIndex} / ${job.urls.length}…`;
      setCsvDownloadStatus(true, label);
      emit({
        jobId: job.id,
        done: job.nextIndex,
        total: job.urls.length,
        failed: job.failed,
        label,
        status: "running",
      });
      void pumpAll();
    } catch {
      /* ignore */
    }
  })();
}

export async function getActiveCsvDownloadJob(): Promise<JobMeta | null> {
  const running = await getRunningJobs();
  return running[0] ?? null;
}
