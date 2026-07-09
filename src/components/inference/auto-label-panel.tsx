"use client";

import { useEffect, useState } from "react";
import {
  cancelInferenceJob,
  fetchModelsAvailability,
  resumeInferenceJob,
  startAutoLabel,
} from "@/lib/actions/inference";
import type { JobResponse } from "@/lib/worker/client";
import type { Model, Dataset } from "@/lib/types/database";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { InferenceConfigFields } from "@/components/inference/inference-config";
import { JobProgress } from "@/components/inference/job-progress";
import { DetectionResults } from "@/components/inference/detection-results";
import { ModelMultiSelect } from "@/components/inference/model-multi-select";
import { Tags, ArrowRight, RotateCcw, Square, Play } from "lucide-react";
import Link from "next/link";
import { defaultLabelModelIds } from "@/lib/model-compatibility";
import {
  clearActiveInferenceJob,
  readActiveInferenceJob,
  writeActiveInferenceJob,
} from "@/lib/inference/active-job";

interface AutoLabelPanelProps {
  projectId: string;
  models: Model[];
  datasets: Dataset[];
  defaultDatasetId?: string;
  lockDataset?: boolean;
  reviewHref?: string;
}

function labeledCount(job: JobResponse | null): number {
  if (!job?.result || typeof job.result !== "object") return 0;
  const n = (job.result as { labeled?: number }).labeled;
  return typeof n === "number" ? n : 0;
}

export function AutoLabelPanel({
  projectId,
  models,
  datasets,
  defaultDatasetId,
  lockDataset = false,
  reviewHref,
}: AutoLabelPanelProps) {
  const initialDatasetId =
    defaultDatasetId && datasets.some((d) => d.id === defaultDatasetId)
      ? defaultDatasetId
      : datasets[0]?.id ?? "";
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(() =>
    defaultLabelModelIds(models)
  );
  const [datasetId, setDatasetId] = useState(initialDatasetId);
  const [confidence, setConfidence] = useState(0.15);
  const [iou, setIou] = useState(0.45);
  const [relabelAll, setRelabelAll] = useState(false);
  const [saveToDataset, setSaveToDataset] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [completedJob, setCompletedJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());
  const [unavailableReasons, setUnavailableReasons] = useState<Record<string, string>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(true);

  const selectedDataset = datasets.find((d) => d.id === datasetId);
  const selectedDatasetName = selectedDataset?.name ?? "dataset";
  const isRunning = !!jobId && !completedJob;
  const labeled = labeledCount(completedJob);
  const dbTotal =
    completedJob?.result && typeof completedJob.result === "object"
      ? ((completedJob.result as { db_total?: number }).db_total ??
        (completedJob.result as { total_files?: number }).total_files ??
        0)
      : 0;
  const canLabelRemaining =
    completedJob?.status === "completed" &&
    labeled > 0 &&
    dbTotal > labeled &&
    !isRunning;
  const canReview =
    !!reviewHref &&
    completedJob &&
    (completedJob.status === "completed" || labeled > 0);
  const canResume =
    completedJob?.job_type === "auto_label" &&
    (completedJob.status === "cancelled" || completedJob.status === "failed");

  useEffect(() => {
    let cancelled = false;
    setAvailabilityLoading(true);
    fetchModelsAvailability(projectId).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setUnavailableIds(new Set());
        setUnavailableReasons({});
        setAvailabilityLoading(false);
        return;
      }
      const missing = new Set<string>();
      const reasons: Record<string, string> = {};
      for (const row of result.models) {
        if (!row.available) {
          missing.add(row.modelId);
          if (row.error) reasons[row.modelId] = row.error;
        }
      }
      setUnavailableIds(missing);
      setUnavailableReasons(reasons);
      setAvailabilityLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, models]);

  useEffect(() => {
    setSelectedModelIds((prev) => {
      const valid = prev.filter(
        (id) => models.some((m) => m.id === id) && !unavailableIds.has(id)
      );
      if (valid.length > 0) return valid;
      return defaultLabelModelIds(models);
    });
  }, [models, unavailableIds]);

  useEffect(() => {
    const active = readActiveInferenceJob();
    if (!active) return;
    if (active.projectId !== projectId) return;
    if (active.jobType !== "auto_label") return;

    const exists = datasets.some((d) => d.id === active.datasetId);
    if (!exists) return;

    setDatasetId(active.datasetId);
    setJobId(active.jobId);
    setCompletedJob(null);
  }, [projectId, datasets]);

  async function handleRun(skipLabeled = false) {
    if (selectedModelIds.length === 0 || !datasetId) {
      setError("Select at least one model and a dataset");
      return;
    }

    const blocked = selectedModelIds.filter((id) => unavailableIds.has(id));
    if (blocked.length > 0) {
      const names = blocked
        .map((id) => models.find((m) => m.id === id)?.name ?? id.slice(0, 8))
        .join(", ");
      setError(
        `Selected model(s) missing weight file: ${names}. Re-upload from Models page.`
      );
      return;
    }

    const availableCount = models.filter((m) => !unavailableIds.has(m.id)).length;
    if (availableCount === 0) {
      setError("No models have weight files ready. Upload .pt/.onnx from Models page first.");
      return;
    }

    setLoading(true);
    setError(null);
    setCompletedJob(null);

    const result = await startAutoLabel(
      projectId,
      selectedModelIds,
      datasetId,
      {
        confidence,
        iou,
        save_to_dataset: saveToDataset,
        relabel_all: relabelAll,
      },
      { skipLabeled }
    );

    if ("error" in result && result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if ("job_id" in result) {
      setJobId(result.job_id);
      writeActiveInferenceJob({
        projectId,
        datasetId,
        jobId: result.job_id,
        jobType: "auto_label",
        createdAt: Date.now(),
      });
    }
    setLoading(false);
  }

  function handleReset() {
    setJobId(null);
    setCompletedJob(null);
    setError(null);
    clearActiveInferenceJob();
  }

  async function handleCancel() {
    if (!jobId) return;
    setCancelling(true);
    setError(null);
    const result = await cancelInferenceJob(jobId, projectId);
    if ("error" in result && result.error) {
      setError(result.error);
      setCancelling(false);
      return;
    }
    const cancelledJob = result as JobResponse;
    setCompletedJob(cancelledJob);
    setJobId(null);
    clearActiveInferenceJob();
    setCancelling(false);
  }

  async function handleResume() {
    if (!completedJob) return;
    setResuming(true);
    setError(null);
    const result = await resumeInferenceJob(completedJob.id, projectId);
    if ("error" in result && result.error) {
      setError(result.error);
      setResuming(false);
      return;
    }
    if ("job_id" in result) {
      setJobId(result.job_id);
      setCompletedJob(null);
      writeActiveInferenceJob({
        projectId,
        datasetId,
        jobId: result.job_id,
        jobType: "auto_label",
        createdAt: Date.now(),
      });
    }
    setResuming(false);
  }

  if (!models.length) {
    return <Alert variant="info">Upload a YOLO model (.pt) first.</Alert>;
  }
  if (!datasets.length) {
    return <Alert variant="info">Create a dataset and upload images first.</Alert>;
  }

  return (
    <Card>
      <CardHeader
        title={lockDataset ? "Label all images with model(s)" : "Auto-label dataset"}
        description={
          lockDataset
            ? "Select models — har image par sab merge ho kar ek label save hogi."
            : "Run YOLO on every image; multiple models merge into one label per image."
        }
      />

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="space-y-4">
        <div className={lockDataset ? "" : "grid gap-4 sm:grid-cols-2"}>
          <ModelMultiSelect
            models={models}
            selectedIds={selectedModelIds}
            onChange={setSelectedModelIds}
            disabled={loading || isRunning || availabilityLoading}
            unavailableIds={unavailableIds}
            unavailableReasons={unavailableReasons}
          />
          {!lockDataset && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Dataset</label>
              <select
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                disabled={isRunning}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.file_count} files)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {selectedDataset && (
          <p className="text-sm text-slate-500">
            {selectedModelIds.length} model
            {selectedModelIds.length !== 1 ? "s" : ""} →{" "}
            {relabelAll ? (
              <>
                <strong>{selectedDataset.file_count}</strong> image
                {selectedDataset.file_count !== 1 ? "s" : ""} (sab, including pehle labeled /
                empty detections)
              </>
            ) : (
              <>
                unlabeled + empty detections only (pehle labeled skip) — dataset mein{" "}
                <strong>{selectedDataset.file_count}</strong> total
              </>
            )}{" "}
            in &quot;{selectedDataset.name}&quot;
            {selectedModelIds.length > 2 && (
              <span className="block text-amber-700">
                Using {selectedModelIds.length} models — labeling runs one model at a time to
                save memory. Large datasets may take several minutes.
              </span>
            )}
            {selectedModelIds.length === 1 &&
              selectedDataset.file_count > 0 &&
              selectedDataset.file_count <= 80 && (
                <span className="block text-emerald-700">
                  1 model + ≤80 images — worker uses high-quality 640px inference for clearer
                  labels. 50–70 images per run is ideal on Railway.
                </span>
              )}
            {selectedModelIds.length === 1 && selectedDataset.file_count > 80 && (
              <span className="block text-amber-700">
                Dataset has {selectedDataset.file_count} images. For clearer labels, label in
                batches of 50–70 (split dataset or use &quot;Label remaining&quot;) with one model
                only.
              </span>
            )}
          </p>
        )}

        <InferenceConfigFields
          confidence={confidence}
          iou={iou}
          onConfidenceChange={setConfidence}
          onIouChange={setIou}
        />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={saveToDataset}
            onChange={(e) => setSaveToDataset(e.target.checked)}
            disabled={isRunning}
            className="rounded border-slate-300"
          />
          Save annotations to dataset files
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={relabelAll}
            onChange={(e) => setRelabelAll(e.target.checked)}
            disabled={isRunning}
            className="rounded border-slate-300"
          />
          Relabel all images (including already labeled / empty detections)
        </label>

        <p className="text-xs text-amber-800">
          Tilted ya angled shelf photos ke liye confidence 0.10–0.20 rakho. Worker EXIF +
          portrait fix inference par bhi lagata hai.
        </p>

        <Button
          onClick={() => handleRun(false)}
          loading={loading}
          disabled={isRunning || selectedModelIds.length === 0}
        >
          {!loading && <Tags className="h-4 w-4" />}
          {loading
            ? "Submitting…"
            : lockDataset
              ? "Label all images"
              : "Start auto-label"}
        </Button>

        <div className="flex flex-wrap gap-2">
          {isRunning && (
            <Button
              type="button"
              variant="danger"
              onClick={handleCancel}
              loading={cancelling}
            >
              {!cancelling && <Square className="h-4 w-4" />}
              Cancel
            </Button>
          )}

          {canResume && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleResume}
              loading={resuming}
            >
              {!resuming && <Play className="h-4 w-4" />}
              Resume
            </Button>
          )}
        </div>

        {isRunning && (
          <Alert variant="info">
            Labeling <strong>{selectedDatasetName}</strong> with {selectedModelIds.length}{" "}
            model{selectedModelIds.length !== 1 ? "s" : ""}
            {relabelAll
              ? ` — relabel all ${selectedDataset?.file_count ?? ""} images`
              : " — sirf unlabeled / empty detections"}
            . You can switch pages and return — progress is saved.
          </Alert>
        )}

        <JobProgress
          jobId={jobId}
          projectId={projectId}
          onComplete={(job) => {
            setCompletedJob(job);
            if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
              setJobId(null);
              clearActiveInferenceJob();
            }
          }}
        />

        {completedJob?.status === "failed" && (
          <Alert variant="error">
            <p className="font-medium">Auto-label failed</p>
            <p className="mt-1">{completedJob.error_message ?? "Unknown worker error"}</p>
          </Alert>
        )}

        {completedJob?.status === "cancelled" && (
          <Alert variant="info">
            Auto-label stopped. Use Resume to queue it again with the same dataset and models.
          </Alert>
        )}

        {completedJob?.status === "completed" && <DetectionResults job={completedJob} />}

        {canReview && (
          <Link href={reviewHref!}>
            <Button className="w-full">
              Review & approve labels
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}

        {canLabelRemaining && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleRun(true)}
            loading={loading}
            disabled={isRunning}
          >
            <Tags className="h-4 w-4" />
            Label remaining ({dbTotal - labeled} images)
          </Button>
        )}

        {completedJob && (
          <Button type="button" variant="secondary" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" />
            Start over
          </Button>
        )}
      </div>
    </Card>
  );
}
