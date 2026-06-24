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
    const labeled = result.labeled as number;
    const failed = result.failed as number;
    const total = result.total_files as number;
    const modelsUsed = (result.models_used as number) ?? 1;
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        <p className="font-medium">Auto-label complete</p>
        <p className="mt-1">
          {labeled}/{total} files labeled using {modelsUsed} model
          {modelsUsed !== 1 ? "s" : ""}
          {failed > 0 && ` · ${failed} failed`}
        </p>
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
