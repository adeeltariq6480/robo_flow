"use client";

import type { JobResponse } from "@/lib/worker/client";

interface Detection {
  class_name: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  project_class_id?: string | null;
}

function countDetectionsByClass(detections: Detection[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of detections) {
    const name = (d.class_name || "unknown").trim() || "unknown";
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function ClassSummary({ detections }: { detections: Detection[] }) {
  const counts = countDetectionsByClass(detections);
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {entries.map(([name, count]) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-900"
        >
          {name}: <strong>{count}</strong>
        </span>
      ))}
    </div>
  );
}

export function DetectionResults({ job }: { job: JobResponse }) {
  if (!job.result) return null;

  const result = job.result as Record<string, unknown>;

  if (job.job_type === "test_run") {
    const inference = result.inference as { detections?: Detection[]; inference_ms?: number };
    const detections = inference?.detections ?? [];
    return (
      <div>
        <ClassSummary detections={detections} />
        <DetectionList detections={detections} ms={inference?.inference_ms} />
      </div>
    );
  }

  if (job.job_type === "auto_label") {
    const labeled = (result.labeled as number) ?? 0;
    const failed = (result.failed as number) ?? 0;
    const total = (result.total_files as number) ?? 0;
    const dbTotal = (result.db_total as number) ?? total;
    const skippedNotEligible = (result.skipped_not_eligible as number) ?? 0;
    const skippedNotRemoteReady = (result.skipped_not_remote_ready as number) ?? 0;
    const skippedAlreadyLabeled = (result.skipped_already_labeled as number) ?? 0;
    const skippedBlurry = (result.skipped_blurry as number) ?? 0;
    const relabelAll = (result.relabel_all as boolean) ?? false;
    const modelsUsed = (result.models_loaded as number) ?? (result.models_used as number) ?? 1;
    const modelsSelected = (result.models_selected as number) ?? modelsUsed;
    const modelsFailed = (result.models_failed as number) ?? 0;
    const modelFailures = Array.isArray(result.model_failures)
      ? (result.model_failures as Array<{
          model_id: string;
          model_name?: string;
          error: string;
        }>)
      : [];
    const variant =
      labeled === 0
        ? "error"
        : failed > 0 ||
            skippedNotEligible > 0 ||
            skippedNotRemoteReady > 0 ||
            skippedBlurry > 0 ||
            modelsFailed > 0
          ? "warning"
          : "success";
    const border =
      variant === "error"
        ? "border-red-200 bg-red-50 text-red-800"
        : variant === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-green-200 bg-green-50 text-green-800";
    return (
      <div className={`rounded-lg border p-4 text-sm ${border}`}>
        <p className="font-medium">
          {labeled === 0 ? "Auto-label failed" : "Auto-label complete"}
        </p>
        <p className="mt-1">
          {labeled}/{total} files labeled
          {modelsSelected > 1 || modelsFailed > 0 ? (
            <>
              {" "}
              · {modelsUsed}/{modelsSelected} model
              {modelsSelected !== 1 ? "s" : ""} loaded
              {modelsFailed > 0 && ` · ${modelsFailed} failed`}
            </>
          ) : (
            <>
              {" "}
              using {modelsUsed} model
              {modelsUsed !== 1 ? "s" : ""}
            </>
          )}
          {dbTotal > total && !relabelAll && ` · ${dbTotal} total in dataset`}
          {relabelAll && dbTotal > 0 && ` · relabel labeled images mode`}
          {failed > 0 && ` · ${failed} image errors`}
        </p>
        {modelsFailed > 0 && modelsUsed > 0 && (
          <p className="mt-2 text-xs text-amber-900">
            You selected {modelsSelected} model{modelsSelected !== 1 ? "s" : ""}, but only{" "}
            {modelsUsed} merged into labels. The {modelsFailed} failed model
            {modelsFailed !== 1 ? "s" : ""} below were skipped (download / load / incompatible /
            OOM). Fix and re-run, or deselect them.
          </p>
        )}
        {modelFailures.length > 0 && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-100/60 px-3 py-2">
            <p className="text-xs font-semibold text-amber-950">
              Why these models did not merge:
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-950">
              {modelFailures.slice(0, 8).map((m) => (
                <li key={m.model_id}>
                  <span className="font-medium">{m.model_name ?? m.model_id.slice(0, 8)}</span>
                  : {m.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(skippedAlreadyLabeled > 0 || skippedNotEligible > 0 || skippedNotRemoteReady > 0) && (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-900">
            {skippedAlreadyLabeled > 0 && (
              <li>
                {skippedAlreadyLabeled} skipped — already labeled / reviewed (images with no
                detections are retried)
              </li>
            )}
            {skippedNotRemoteReady > 0 && (
              <li>
                {skippedNotRemoteReady} missing on HF — complete upload sync or retry HF sync
              </li>
            )}
            {skippedNotEligible > 0 && (
              <li>
                {skippedNotEligible} missing — record in DB but file not found on HF/disk
              </li>
            )}
            {skippedBlurry > 0 && (
              <li>
                {skippedBlurry} skipped — too blurry for labeling (only sharp images are
                processed)
              </li>
            )}
          </ul>
        )}
        {labeled > 0 && labeled < dbTotal && skippedAlreadyLabeled === 0 && (
          <p className="mt-2 text-amber-800">
            For remaining images, check HF sync first, then click &quot;Label remaining&quot;.
          </p>
        )}
        {skippedAlreadyLabeled > 0 && labeled < dbTotal && !relabelAll && (
          <p className="mt-2 text-amber-800">
            To relabel images that already have labels, tick &quot;Relabel already labeled images&quot;.
          </p>
        )}
      </div>
    );
  }

  if (job.job_type === "model_compare") {
    const comparison = result.comparison as {
      winner_model_id?: string;
      winner_reason?: string;
      models?: Record<string, { detections?: Detection[]; inference_ms?: number; model_name?: string }>;
    };
    const models = comparison?.models ?? {};
    const entries = Object.entries(models);

    return (
      <div className="space-y-4">
        {comparison?.winner_model_id && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-medium text-amber-900">Winner model</p>
            <p className="text-amber-800">{comparison.winner_model_id.slice(0, 8)}…</p>
            <p className="mt-1 text-amber-700">{comparison.winner_reason}</p>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {entries.map(([modelId, inf]) => (
            <div key={modelId} className="rounded-lg border border-slate-200 p-4">
              <h4 className="mb-2 font-medium text-slate-900">
                Model {modelId.slice(0, 8)}…
                {modelId === comparison?.winner_model_id && (
                  <span className="ml-2 text-xs text-amber-600">★ winner</span>
                )}
              </h4>
              <ClassSummary detections={inf.detections ?? []} />
              <DetectionList detections={inf.detections ?? []} ms={inf.inference_ms} compact />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function DetectionList({
  detections,
  ms,
  compact,
}: {
  detections: Detection[];
  ms?: number;
  compact?: boolean;
}) {
  if (detections.length === 0) {
    return <p className="text-sm text-slate-500">No detections found.</p>;
  }

  return (
    <div>
      {ms != null && (
        <p className="mb-2 text-xs text-slate-400">Inference: {ms.toFixed(1)} ms</p>
      )}
      <ul className={`space-y-1 ${compact ? "text-xs" : "text-sm"}`}>
        {detections.map((d, i) => (
          <li
            key={i}
            className="flex items-center justify-between rounded bg-slate-50 px-2 py-1"
          >
            <span className="font-medium text-slate-800">{d.class_name}</span>
            <span className="text-slate-500">
              {(d.confidence * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
