import { API_BASE_URL } from "@/lib/api/client";

const WORKER_API_KEY = process.env.WORKER_API_KEY ?? "";

type JobType = "test_run" | "auto_label" | "model_compare";

export interface JobConfig {
  confidence?: number;
  iou?: number;
  class_name_map?: Record<string, string>;
  save_to_dataset?: boolean;
  relabel_all?: boolean;
}

export interface JobResponse {
  id: string;
  project_id: string;
  job_type: JobType;
  queue_name: "interactive" | "batch" | "compare";
  status: string;
  progress: number;
  progress_message?: string;
  total_items: number;
  processed_items: number;
  result?: Record<string, unknown>;
  error_message?: string;
}

function workerHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extra as Record<string, string>),
  };
  if (WORKER_API_KEY) {
    headers["X-Worker-Key"] = WORKER_API_KEY;
  }
  return headers;
}

async function readResponseText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function parseWorkerError(res: Response): Promise<string> {
  const raw = await readResponseText(res);
  if (!raw.trim()) return `Worker error ${res.status}`;
  try {
    const data = JSON.parse(raw) as {
      detail?: string | Array<{ msg?: string }>;
    };
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) {
      return data.detail.map((d) => d.msg).filter(Boolean).join(", ");
    }
    return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
  } catch {
    return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
  }
}

async function workerFetchWithRetry(
  url: string,
  options: RequestInit
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function workerFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await workerFetchWithRetry(`${API_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: workerHeaders(options.headers),
  });

  if (!res.ok) {
    const message = await parseWorkerError(res);
    if (res.status === 401) {
      throw new Error(
        "Backend rejected the API key (401). Set WORKER_API_KEY on Vercel to match Railway, " +
          "or remove WORKER_API_KEY on Railway for no-auth mode."
      );
    }
    throw new Error(message || `Worker error ${res.status}`);
  }

  const raw = await readResponseText(res);
  if (!raw.trim()) {
    return undefined as T;
  }
  return JSON.parse(raw) as T;
}

export async function submitTestRun(body: {
  project_id: string;
  model_id: string;
  dataset_file_id?: string;
  image_path?: string;
  config?: JobConfig;
}) {
  return workerFetch<{ job_id: string; queue_name: string; message: string }>(
    "/jobs/test-run",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export async function submitAutoLabel(body: {
  project_id: string;
  model_id?: string;
  model_ids: string[];
  dataset_id: string;
  skip_labeled?: boolean;
  relabel_all?: boolean;
  config?: JobConfig;
}) {
  return workerFetch<{ job_id: string; queue_name: string; message: string }>(
    "/jobs/auto-label",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export async function submitModelCompare(body: {
  project_id: string;
  model_ids: string[];
  dataset_file_id?: string;
  image_path?: string;
  config?: JobConfig;
}) {
  return workerFetch<{ job_id: string; queue_name: string; message: string }>(
    "/jobs/model-compare",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export interface DatasetLabelStats {
  total: number;
  eligible: number;
  ready: number;
  unlabeled: number;
  already_labeled: number;
  skipped_not_eligible: number;
  skipped_not_remote_ready: number;
}

export async function getDatasetLabelStats(projectId: string, datasetId: string) {
  return workerFetch<DatasetLabelStats>(
    `/api/datasets/${projectId}/${datasetId}/label-stats`
  );
}

export interface DatasetInventoryImage {
  image_id: string;
  file_name: string;
  status: string;
  review_status?: string | null;
  width?: number | null;
  height?: number | null;
  total_objects: number;
  class_counts: Record<string, number>;
}

export interface DatasetInventory {
  dataset_id: string;
  image_count: number;
  labeled_count: number;
  total_objects: number;
  class_totals: Record<string, number>;
  /** Stable class column order for stock-check table/grid */
  class_names?: string[];
  images: DatasetInventoryImage[];
}

export async function getDatasetInventory(projectId: string, datasetId: string) {
  return workerFetch<DatasetInventory>(
    `/api/datasets/${projectId}/${datasetId}/inventory`
  );
}

export async function getActiveDatasetJob(projectId: string, datasetId: string) {
  return workerFetch<JobResponse>(
    `/api/datasets/${projectId}/${datasetId}/active-job?job_type=auto_label`
  );
}

export async function createColabLaunch(body: {
  project_id: string;
  dataset_id: string;
  model_ids: string[];
  confidence?: number;
  iou?: number;
  relabel_all?: boolean;
}) {
  return workerFetch<{ colab_url: string; prefill_url?: string | null; job_id?: string | null; message: string; expires_in_minutes: number }>(
    "/api/colab/launch",
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** Poll job status — prefers project-scoped route (more reliable than global registry). */
export async function getJob(
  jobId: string,
  projectId?: string
): Promise<JobResponse> {
  if (projectId) {
    return workerFetch<JobResponse>(`/api/jobs/${projectId}/${jobId}`);
  }
  return workerFetch<JobResponse>(`/jobs/${jobId}`);
}

export async function cancelJob(
  jobId: string,
  projectId?: string
): Promise<JobResponse> {
  if (projectId) {
    return workerFetch<JobResponse>(`/api/jobs/${projectId}/${jobId}/cancel`, {
      method: "POST",
    });
  }
  return workerFetch<JobResponse>(`/jobs/${jobId}/cancel`, { method: "POST" });
}

export async function resumeJob(
  jobId: string,
  projectId?: string
): Promise<{ job_id: string; queue_name: string; message: string }> {
  if (projectId) {
    return workerFetch<{ job_id: string; queue_name: string; message: string }>(
      `/api/jobs/${projectId}/${jobId}/resume`,
      { method: "POST" }
    );
  }
  return workerFetch<{ job_id: string; queue_name: string; message: string }>(
    `/jobs/${jobId}/resume`,
    { method: "POST" }
  );
}

export async function getQueueStats() {
  return workerFetch<
    Record<string, { pending: number; running: number; max_workers: number }>
  >("/jobs/queues/stats");
}

export async function previewHfCleanup(repo_id: string, repo_type: string) {
  return workerFetch<{ repo_id: string; repo_type: string; files: string[]; message?: string }>(
    `/api/admin/hf-cleanup/preview?repo_id=${encodeURIComponent(repo_id)}&repo_type=${encodeURIComponent(repo_type)}`
  );
}

export async function deleteHfCleanup(body: {
  repo_id: string;
  repo_type: string;
  confirmation: string;
}) {
  return workerFetch<{ success: boolean; deleted_count: number; deleted_files: string[]; message?: string }>(
    "/api/admin/hf-cleanup/delete",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function deleteHfRepo(body: {
  repo_id: string;
  repo_type: string;
  confirmation: string;
}) {
  return workerFetch<{
    success: boolean;
    deleted_repo: string;
    repo_type: string;
    message?: string;
  }>("/api/admin/hf-cleanup/delete-repo", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
