"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJobStatus } from "@/lib/actions/inference";
import type { JobResponse } from "@/lib/worker/client";
import { Alert } from "@/components/ui/alert";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

interface JobProgressProps {
  jobId: string | null;
  projectId?: string;
  onComplete?: (job: JobResponse) => void;
}

export function JobProgress({ jobId, projectId, onComplete }: JobProgressProps) {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }

    let cancelled = false;

    async function poll() {
      const result = await fetchJobStatus(jobId!, projectId);
      if (cancelled) return;

      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }

      const j = result as JobResponse;
      setJob(j);
      setError(null);

      if (j.status === "completed" || j.status === "failed") {
        onCompleteRef.current?.(j);
        return;
      }

      setTimeout(poll, 1500);
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, projectId]);

  if (!jobId) return null;

  if (error) {
    return (
      <Alert variant="error">
        Worker error: {error}. Is the Python worker running on port 8000?
      </Alert>
    );
  }

  if (!job) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Connecting to worker…
      </div>
    );
  }

  const isDone = job.status === "completed";
  const isFailed = job.status === "failed";

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium text-slate-700">
          {isDone && <CheckCircle className="h-4 w-4 text-green-600" />}
          {isFailed && <XCircle className="h-4 w-4 text-red-600" />}
          {!isDone && !isFailed && <Loader2 className="h-4 w-4 animate-spin text-brand-600" />}
          {job.progress_message || job.status}
        </span>
        <span className="text-slate-500">
          {job.processed_items > 0 && `${job.processed_items}/${job.total_items} · `}
          {job.progress}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full transition-all duration-500 ${
            isFailed ? "bg-red-500" : isDone ? "bg-green-500" : "bg-brand-600"
          }`}
          style={{ width: `${job.progress}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Queue: {job.queue_name} · Job: {job.id.slice(0, 8)}…
      </p>
      {isFailed && job.error_message && (
        <p className="mt-2 text-sm text-red-600">{job.error_message}</p>
      )}
      {job.status === "completed" &&
        job.result &&
        typeof job.result === "object" &&
        ((job.result as { failed?: number }).failed ?? 0) > 0 && (
          <FileFailureSummary result={job.result as Record<string, unknown>} />
        )}
    </div>
  );
}

function FileFailureSummary({ result }: { result: Record<string, unknown> }) {
  const files = Array.isArray(result.files) ? result.files : [];
  const errors = files
    .filter((f): f is { file_id?: string; error: string } =>
      typeof f === "object" && f !== null && "error" in f && typeof (f as { error: unknown }).error === "string"
    )
    .slice(0, 5);

  if (errors.length === 0) return null;

  return (
    <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-medium">Some images failed:</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {errors.map((f, i) => (
          <li key={f.file_id ?? i}>
            {f.file_id ? `${f.file_id.slice(0, 8)}…: ` : ""}
            {f.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
