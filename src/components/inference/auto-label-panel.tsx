"use client";

import { useEffect, useState } from "react";
import { openColabLaunch } from "@/lib/actions/colab";
import {
  cancelInferenceJob,
  fetchDatasetLabelStats,
  fetchModelsAvailability,
  resumeInferenceJob,
  startAutoLabel,
} from "@/lib/actions/inference";
import type { DatasetLabelStats } from "@/lib/worker/client";
import type { JobResponse } from "@/lib/worker/client";
import type { Model, Dataset } from "@/lib/types/database";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { InferenceConfigFields } from "@/components/inference/inference-config";
import { JobProgress } from "@/components/inference/job-progress";
import { DetectionResults } from "@/components/inference/detection-results";
import { ModelMultiSelect } from "@/components/inference/model-multi-select";
import { Tags, ArrowRight, RotateCcw, Square, Play, ExternalLink } from "lucide-react";
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
  const [labelStats, setLabelStats] = useState<DatasetLabelStats | null>(null);
  const [labelStatsLoading, setLabelStatsLoading] = useState(false);
  const [colabLoading, setColabLoading] = useState(false);

  const selectedDataset = datasets.find((d) => d.id === datasetId);
  const selectedDatasetName = selectedDataset?.name ?? "dataset";
  const imagesToLabel = relabelAll
    ? (labelStats?.already_labeled ?? 0)
    : (labelStats?.unlabeled ?? 0);
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
    if (!datasetId) {
      setLabelStats(null);
      return;
    }

    let cancelled = false;
    setLabelStatsLoading(true);
    fetchDatasetLabelStats(projectId, datasetId).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setLabelStats(null);
      } else {
        setLabelStats(result);
      }
      setLabelStatsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, datasetId, completedJob?.status]);

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

  async function handleOpenColab() {
    if (!datasetId || selectedModelIds.length === 0) {
      setError("Select at least one model and a dataset");
      return;
    }
    setColabLoading(true);
    setError(null);
    const result = await openColabLaunch({
      projectId,
      datasetId,
      modelIds: selectedModelIds,
      confidence,
      iou,
      relabelAll,
    });
    if ("error" in result) {
      setError(result.error);
      setColabLoading(false);
      return;
    }
    window.open(result.colabUrl, "_blank", "noopener,noreferrer");
    setColabLoading(false);
  }

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
            ? "Select models — all models merge into one label per image."
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

        {selectedDataset && selectedModelIds.length > 0 && (
          <p className="text-sm text-slate-500">
            {selectedModelIds.length} model
            {selectedModelIds.length !== 1 ? "s" : ""} →{" "}
            {labelStatsLoading ? (
              <>counting images…</>
            ) : relabelAll ? (
              <>
                <strong>{imagesToLabel}</strong> already labeled image
                {imagesToLabel !== 1 ? "s" : ""} to relabel
                {labelStats && labelStats.total > imagesToLabel && (
                  <> ({labelStats.unlabeled} unlabeled skipped)</>
                )}
              </>
            ) : (
              <>
                <strong>{imagesToLabel}</strong> unlabeled / empty-detection image
                {imagesToLabel !== 1 ? "s" : ""} to label
                {labelStats && labelStats.already_labeled > 0 && (
                  <> ({labelStats.already_labeled} already labeled skipped)</>
                )}
              </>
            )}{" "}
            in &quot;{selectedDataset.name}&quot;
            {labelStats && (
              <span className="block text-slate-400">
                {labelStats.total} total in dataset
                {labelStats.skipped_not_eligible > 0 &&
                  ` · ${labelStats.skipped_not_eligible} not eligible`}
                {labelStats.skipped_not_remote_ready > 0 &&
                  ` · ${labelStats.skipped_not_remote_ready} missing on HF`}
              </span>
            )}
            {selectedModelIds.length > 1 && (
              <span className="block text-emerald-700">
                All {selectedModelIds.length} models are prepared and merged first, then labeling
                starts on {imagesToLabel || (relabelAll ? "labeled" : "unlabeled")} images.
              </span>
            )}
            {selectedModelIds.length > 2 && (
              <span className="block text-amber-700">
                If Railway runs low on RAM, the worker loads models per image while still merging
                all results before saving.
              </span>
            )}
            {!labelStatsLoading && imagesToLabel === 0 && (
              <span className="block text-amber-700">
                {relabelAll
                  ? "No already labeled images in this dataset. Uncheck Relabel to label unlabeled images."
                  : "No unlabeled images left. Check Relabel already labeled images to run again on labeled images."}
              </span>
            )}
            {selectedModelIds.length === 1 &&
              imagesToLabel > 0 &&
              imagesToLabel <= 80 && (
                <span className="block text-emerald-700">
                  1 model + ≤80 images — worker uses high-quality 640px inference for clearer
                  labels. 50–70 images per run is ideal on Railway.
                </span>
              )}
            {selectedModelIds.length === 1 && imagesToLabel > 80 && (
              <span className="block text-amber-700">
                {imagesToLabel} images to process. For clearer labels, label in batches of 50–70
                (split dataset or use &quot;Label remaining&quot;) with one model only.
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
          Relabel already labeled images
        </label>

        {!relabelAll && (
          <p className="text-xs text-slate-500">
            Default: only unlabeled images and empty detections are processed.
          </p>
        )}
        {relabelAll && (
          <p className="text-xs text-slate-500">
            Relabel mode: only images that already have labels will be processed again.
          </p>
        )}

        <p className="text-xs text-amber-800">
          For tilted or angled shelf photos, keep confidence around 0.10–0.20. The worker also
          applies EXIF and portrait correction during inference.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => handleRun(false)}
            loading={loading}
            disabled={isRunning || selectedModelIds.length === 0 || imagesToLabel === 0}
          >
            {!loading && <Tags className="h-4 w-4" />}
            {loading
              ? "Submitting…"
              : lockDataset
                ? "Label on Railway"
                : "Start auto-label"}
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={handleOpenColab}
            loading={colabLoading}
            disabled={
              isRunning || colabLoading || selectedModelIds.length === 0 || imagesToLabel === 0
            }
            title="Opens Google Colab with project, dataset, models and secrets pre-filled"
          >
            {!colabLoading && <ExternalLink className="h-4 w-4" />}
            Open in Colab
          </Button>
        </div>

        <p className="text-xs text-slate-500">
          <strong>Open in Colab</strong> — everything pre-filled; in Colab click{" "}
          <strong>Runtime → Run all</strong>. Falls back to Railway if Colab fails.
        </p>

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
              ? ` — relabel ${imagesToLabel} already labeled image${imagesToLabel !== 1 ? "s" : ""}`
              : ` — label ${imagesToLabel} unlabeled image${imagesToLabel !== 1 ? "s" : ""}`}
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
