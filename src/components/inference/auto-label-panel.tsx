"use client";

import { useEffect, useState } from "react";
import { startAutoLabel } from "@/lib/actions/inference";
import type { JobResponse } from "@/lib/worker/client";
import type { Model, Dataset } from "@/lib/types/database";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { InferenceConfigFields } from "@/components/inference/inference-config";
import { JobProgress } from "@/components/inference/job-progress";
import { DetectionResults } from "@/components/inference/detection-results";
import { ModelMultiSelect } from "@/components/inference/model-multi-select";
import { Tags, ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
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
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(
    models[0] ? [models[0].id] : []
  );
  const [datasetId, setDatasetId] = useState(initialDatasetId);
  const [confidence, setConfidence] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [saveToDataset, setSaveToDataset] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [completedJob, setCompletedJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedDataset = datasets.find((d) => d.id === datasetId);
  const selectedDatasetName = selectedDataset?.name ?? "dataset";
  const isRunning = !!jobId && !completedJob;
  const labeled = labeledCount(completedJob);
  const canReview =
    !!reviewHref &&
    completedJob &&
    (completedJob.status === "completed" || labeled > 0);

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

  async function handleRun() {
    if (selectedModelIds.length === 0 || !datasetId) {
      setError("Select at least one model and a dataset");
      return;
    }
    setLoading(true);
    setError(null);
    setCompletedJob(null);

    const result = await startAutoLabel(projectId, selectedModelIds, datasetId, {
      confidence,
      iou,
      save_to_dataset: saveToDataset,
    });

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
            ? "Select one or more YOLO models. Each image is labeled with every selected model; overlapping boxes are merged."
            : "Run one or more YOLO models on every image in a dataset."
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
            disabled={loading || isRunning}
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
            {selectedModelIds.length !== 1 ? "s" : ""} × {selectedDataset.file_count} image
            {selectedDataset.file_count !== 1 ? "s" : ""} in &quot;
            {selectedDataset.name}&quot;
            {selectedModelIds.length > 2 && (
              <span className="block text-amber-700">
                Using {selectedModelIds.length} models — labeling runs one model at a time to
                save memory. Large datasets may take several minutes.
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

        <Button
          onClick={handleRun}
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

        {isRunning && (
          <Alert variant="info">
            Labeling <strong>{selectedDatasetName}</strong> with {selectedModelIds.length}{" "}
            model{selectedModelIds.length !== 1 ? "s" : ""}. You can switch pages and return —
            progress is saved.
          </Alert>
        )}

        <JobProgress
          jobId={jobId}
          projectId={projectId}
          onComplete={(job) => {
            setCompletedJob(job);
            if (job.status === "completed" || job.status === "failed") {
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

        {completedJob?.status === "completed" && <DetectionResults job={completedJob} />}

        {canReview && (
          <Link href={reviewHref!}>
            <Button className="w-full">
              Review & approve labels
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}

        {completedJob && (
          <Button type="button" variant="secondary" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" />
            Label again
          </Button>
        )}
      </div>
    </Card>
  );
}
