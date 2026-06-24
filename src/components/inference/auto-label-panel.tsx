"use client";

import { useState } from "react";
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
import { Tags, ArrowRight } from "lucide-react";
import Link from "next/link";

interface AutoLabelPanelProps {
  projectId: string;
  models: Model[];
  datasets: Dataset[];
  /** Pre-select dataset (e.g. from dataset label page) */
  defaultDatasetId?: string;
  /** Hide dataset picker when labeling a specific dataset */
  lockDataset?: boolean;
  /** Show link to review after job completes */
  reviewHref?: string;
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

    if ("job_id" in result) setJobId(result.job_id);
    setLoading(false);
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
            ? "Select one or more YOLO models — har image par sab models chalenge, phir boxes save honge."
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
            disabled={loading || !!jobId}
          />
          {!lockDataset && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Dataset</label>
              <select
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
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
            className="rounded border-slate-300"
          />
          Save annotations to dataset files
        </label>

        <Button
          onClick={handleRun}
          disabled={loading || !!jobId || selectedModelIds.length === 0}
        >
          <Tags className="h-4 w-4" />
          {loading
            ? "Submitting…"
            : lockDataset
              ? "Label all images"
              : "Start auto-label"}
        </Button>

        <p className="text-xs text-slate-500">
          Python worker must be running:{" "}
          <code className="rounded bg-slate-100 px-1">cd worker && uvicorn main:app --reload</code>
        </p>

        <JobProgress
          jobId={jobId}
          onComplete={(job) => {
            setCompletedJob(job);
            if (job.status === "completed") setJobId(null);
          }}
        />

        {completedJob?.status === "completed" && (
          <>
            <DetectionResults job={completedJob} />
            {reviewHref && (
              <Link href={reviewHref}>
                <Button className="w-full">
                  Review & approve labels
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
