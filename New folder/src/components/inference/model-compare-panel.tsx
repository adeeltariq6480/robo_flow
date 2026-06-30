"use client";

import { useState } from "react";
import { startModelCompare } from "@/lib/actions/inference";
import type { JobResponse } from "@/lib/worker/client";
import type { Model } from "@/lib/types/database";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { InferenceConfigFields } from "@/components/inference/inference-config";
import { JobProgress } from "@/components/inference/job-progress";
import { DetectionResults } from "@/components/inference/detection-results";
import type { DatasetFileOption } from "@/components/inference/test-run-panel";
import { GitCompare } from "lucide-react";

interface ModelComparePanelProps {
  projectId: string;
  models: Model[];
  files: DatasetFileOption[];
}

export function ModelComparePanel({ projectId, models, files }: ModelComparePanelProps) {
  const [selectedModels, setSelectedModels] = useState<string[]>(
    models.slice(0, 2).map((m) => m.id)
  );
  const [fileId, setFileId] = useState(files[0]?.id ?? "");
  const [confidence, setConfidence] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [jobId, setJobId] = useState<string | null>(null);
  const [completedJob, setCompletedJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function toggleModel(id: string) {
    setSelectedModels((prev) => {
      if (prev.includes(id)) {
        return prev.filter((m) => m !== id);
      }
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  }

  async function handleCompare() {
    if (selectedModels.length < 2) {
      setError("Select at least 2 models");
      return;
    }
    if (!fileId) {
      setError("Select an image");
      return;
    }

    setLoading(true);
    setError(null);
    setCompletedJob(null);

    const result = await startModelCompare(
      projectId,
      selectedModels,
      fileId,
      { confidence, iou }
    );

    if ("error" in result && result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if ("job_id" in result) setJobId(result.job_id);
    setLoading(false);
  }

  if (models.length < 2) {
    return <Alert variant="info">Upload at least 2 models to compare.</Alert>;
  }
  if (!files.length) {
    return <Alert variant="info">Upload dataset images first.</Alert>;
  }

  return (
    <Card>
      <CardHeader
        title="Compare models"
        description="Run 2–5 models on the same image. Compare queue (medium priority)."
      />

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Models to compare ({selectedModels.length} selected)
          </label>
          <div className="flex flex-wrap gap-2">
            {models.map((m) => {
              const selected = selectedModels.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleModel(m.id)}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    selected
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {m.name} v{m.version}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Test image</label>
          <select
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.dataset_name} / {f.file_name}
              </option>
            ))}
          </select>
        </div>

        <InferenceConfigFields
          confidence={confidence}
          iou={iou}
          onConfidenceChange={setConfidence}
          onIouChange={setIou}
        />

        <Button onClick={handleCompare} loading={loading}>
          {!loading && <GitCompare className="h-4 w-4" />}
          {loading ? "Submitting…" : "Compare models"}
        </Button>

        <JobProgress
          jobId={jobId}
          onComplete={(job) => {
            setCompletedJob(job);
            if (job.status === "completed") setJobId(null);
          }}
        />

        {completedJob?.status === "completed" && (
          <DetectionResults job={completedJob} />
        )}
      </div>
    </Card>
  );
}
