"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJobStatus } from "@/lib/actions/inference";
import type { JobResponse } from "@/lib/worker/client";
import { Alert } from "@/components/ui/alert";
import { Loader2, CheckCircle, XCircle, OctagonX } from "lucide-react";

interface JobProgressProps {
  jobId: string | null;
  projectId?: string;
  onComplete?: (job: JobResponse) => void;
}

const POLL_MS = 8000;
const MAX_POLL_ERRORS = 15;

/** Parse worker auto-label progress messages. */
function parseAutoLabelProgress(message: string | undefined) {
  if (!message) return null;
  const merged = message.match(
    /Labeling image\s+(\d+)\s*\/\s*(\d+)(?:\s*\((\d+)\s*models merged\))?/i
  );
  if (merged) {
    return {
      image: Number(merged[1]),
      images: Number(merged[2]),
      models: merged[3] ? Number(merged[3]) : 1,
      model: 1,
    };
  }
  const legacy = message.match(
    /Model\s+(\d+)\s*\/\s*(\d+)[^0-9]*image\s+(\d+)\s*\/\s*(\d+)/i
  );
  if (legacy) {
    return {
      model: Number(legacy[1]),
      models: Number(legacy[2]),
      image: Number(legacy[3]),
      images: Number(legacy[4]),
    };
  }
  return null;
}

export function JobProgress({ jobId, projectId, onComplete }: JobProgressProps) {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const completedRef = useRef(false);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setError(null);
      completedRef.current = false;
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollErrors = 0;

    async function poll() {
      if (cancelled || completedRef.current) return;

      const result = await fetchJobStatus(jobId!, projectId);
      if (cancelled || completedRef.current) return;

      if ("error" in result && result.error) {
        pollErrors += 1;
        if (pollErrors < MAX_POLL_ERRORS) {
          timer = setTimeout(poll, POLL_MS);
          return;
        }
        setError(result.error);
        return;
      }

      pollErrors = 0;
      const j = result as JobResponse;
      setJob(j);
      setError(null);

      if (j.status === "completed" || j.status === "failed" || j.status === "cancelled") {
        completedRef.current = true;
        onCompleteRef.current?.(j);
        return;
      }

      timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, projectId]);

  if (!jobId) return null;

  if (error) {
    return (
      <Alert variant="error">
        Could not reach the worker: {error}. Check Railway is running and WORKER_API_KEY matches
        Vercel.
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
  const isCancelled = job.status === "cancelled";

  const parsed = parseAutoLabelProgress(job.progress_message ?? undefined);
  const barPercent = Math.min(100, job.progress ?? 0);
  const imageCounter = parsed
    ? `${parsed.image}/${parsed.images}`
    : job.total_items > 0
      ? `${job.processed_items}/${job.total_items}`
      : null;

  const statusLabel = parsed
    ? parsed.models > 1 && parsed.model < parsed.models
      ? `Image ${parsed.image}/${parsed.images} (${parsed.models} models merged)`
      : `Image ${parsed.image}/${parsed.images}`
    : job.progress_message || job.status;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium text-slate-700">
          {isDone && <CheckCircle className="h-4 w-4 text-green-600" />}
          {isFailed && <XCircle className="h-4 w-4 text-red-600" />}
          {isCancelled && <OctagonX className="h-4 w-4 text-amber-600" />}
          {!isDone && !isFailed && !isCancelled && <Loader2 className="h-4 w-4 animate-spin text-brand-600" />}
          {statusLabel}
        </span>
        <span className="text-slate-500">
          {imageCounter && (
            <>
              {imageCounter} images
              {" · "}
            </>
          )}
          {barPercent}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full transition-all duration-500 ${
            isFailed ? "bg-red-500" : isCancelled ? "bg-amber-500" : isDone ? "bg-green-500" : "bg-brand-600"
          }`}
          style={{ width: `${barPercent}%` }}
        />
      </div>
      {parsed && parsed.models > 1 && !isDone && (
        <p className="mt-1 text-xs text-slate-400">
          Har image par {parsed.models} models merge ho kar ek hi label save hoti hai
        </p>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Queue: {job.queue_name} · Job: {job.id.slice(0, 8)}…
      </p>
      {isFailed && job.error_message && (
        <p className="mt-2 text-sm text-red-600">{job.error_message}</p>
      )}
      {isCancelled && (
        <p className="mt-2 text-sm text-amber-700">
          {job.error_message ?? "Auto-label was cancelled."}
        </p>
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
    .filter(
      (f): f is { file_id?: string; error: string } =>
        typeof f === "object" &&
        f !== null &&
        "error" in f &&
        typeof (f as { error: unknown }).error === "string"
    )
    .slice(0, 5);

  const failed = (result.failed as number) ?? 0;
  const labeled = (result.labeled as number) ?? 0;

  return (
    <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-medium">
        {labeled > 0
          ? `${labeled} labeled, ${failed} failed — you can still review successful labels.`
          : `${failed} image(s) failed.`}
      </p>
      {errors.length > 0 && (
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {errors.map((f, i) => (
            <li key={f.file_id ?? i}>
              {f.file_id ? `${f.file_id.slice(0, 8)}…: ` : ""}
              {f.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
