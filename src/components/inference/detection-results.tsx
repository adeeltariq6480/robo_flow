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

export function DetectionResults({ job }: { job: JobResponse }) {
  if (!job.result) return null;

  const result = job.result as Record<string, unknown>;

  if (job.job_type === "test_run") {
    const inference = result.inference as { detections?: Detection[]; inference_ms?: number };
    return <DetectionList detections={inference?.detections ?? []} ms={inference?.inference_ms} />;
  }

  if (job.job_type === "auto_label") {
    const labeled = (result.labeled as number) ?? 0;
    const failed = (result.failed as number) ?? 0;
    const total = (result.total_files as number) ?? 0;
    const dbTotal = (result.db_total as number) ?? total;
    const skippedNotEligible = (result.skipped_not_eligible as number) ?? 0;
    const skippedNotRemoteReady = (result.skipped_not_remote_ready as number) ?? 0;
    const skippedAlreadyLabeled = (result.skipped_already_labeled as number) ?? 0;
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
          {relabelAll && dbTotal > 0 && ` · relabel all mode (${dbTotal} in dataset)`}
          {failed > 0 && ` · ${failed} image errors`}
        </p>
        {modelsFailed > 0 && modelsUsed > 0 && (
          <p className="mt-2 text-xs text-amber-900">
            {modelsUsed} model loaded OK, lekin {modelsFailed} selected model
            {modelsFailed !== 1 ? "s" : ""} ki file missing thi — sirf loaded models
            se label hua. Missing models dubara upload karein.
          </p>
        )}
        {(skippedAlreadyLabeled > 0 || skippedNotEligible > 0 || skippedNotRemoteReady > 0) && (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-900">
            {skippedAlreadyLabeled > 0 && (
              <li>
                {skippedAlreadyLabeled} skipped — pehle se achi labels / reviewed (no
                detections wali images dubara try hoti hain)
              </li>
            )}
            {skippedNotRemoteReady > 0 && (
              <li>
                {skippedNotRemoteReady} missing on HF — upload sync complete karo ya HF sync retry
              </li>
            )}
            {skippedNotEligible > 0 && (
              <li>
                {skippedNotEligible} missing — DB mein record hai lekin file HF/disk par nahi mili
              </li>
            )}
          </ul>
        )}
        {labeled > 0 && labeled < dbTotal && skippedAlreadyLabeled === 0 && (
          <p className="mt-2 text-amber-800">
            Baqi images ke liye pehle HF sync check karo, phir &quot;Label remaining&quot; dabao.
          </p>
        )}
        {skippedAlreadyLabeled > 0 && labeled < dbTotal && !relabelAll && (
          <p className="mt-2 text-amber-800">
            Sab dubara label karni hon to &quot;Relabel all images&quot; checkbox tick karo.
          </p>
        )}
        {modelFailures.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
            {modelFailures.slice(0, 5).map((m) => (
              <li key={m.model_id}>
                <span className="font-medium">{m.model_name ?? m.model_id.slice(0, 8)}</span>
                : {m.error}
              </li>
            ))}
          </ul>
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
