const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";
const WORKER_API_KEY = process.env.WORKER_API_KEY ?? "dev-worker-key";

type JobType = "test_run" | "auto_label" | "model_compare";

export interface JobConfig {
  confidence?: number;
  iou?: number;
  class_name_map?: Record<string, string>;
  save_to_dataset?: boolean;
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

async function workerFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Key": WORKER_API_KEY,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Worker error ${res.status}`);
  }

  return res.json() as Promise<T>;
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

export async function getJob(jobId: string): Promise<JobResponse> {
  return workerFetch<JobResponse>(`/jobs/${jobId}`);
}

export async function getQueueStats() {
  return workerFetch<Record<string, { pending: number; running: number; max_workers: number }>>(
    "/jobs/queues/stats"
  );
}
