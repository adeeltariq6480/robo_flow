"use client";

import { useState } from "react";
import { startTestRun } from "@/lib/actions/inference";
import type { JobResponse } from "@/lib/worker/client";
import type { Model } from "@/lib/types/database";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { InferenceConfigFields } from "@/components/inference/inference-config";
import { JobProgress } from "@/components/inference/job-progress";
import { DetectionResults } from "@/components/inference/detection-results";
import { Play } from "lucide-react";

export interface DatasetFileOption {
  id: string;
  file_name: string;
  dataset_id: string;
  dataset_name: string;
}

interface TestRunPanelProps {
  projectId: string;
  models: Model[];
  files: DatasetFileOption[];
}

export function TestRunPanel({ projectId, models, files }: TestRunPanelProps) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [fileId, setFileId] = useState(files[0]?.id ?? "");
  const [confidence, setConfidence] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [jobId, setJobId] = useState<string | null>(null);
  const [completedJob, setCompletedJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRun() {
    if (!modelId || !fileId) {
      setError("Select a model and an image");
      return;
    }
    setLoading(true);
    setError(null);
    setCompletedJob(null);

    const result = await startTestRun(projectId, modelId, fileId, {
      confidence,
      iou,
    });

    if ("error" in result && result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if ("job_id" in result) {
      setJobId(result.job_id);
    }
    setLoading(false);
  }

  if (!models.length) {
    return <Alert variant="info">Upload a YOLO model (.pt) first.</Alert>;
  }
  if (!files.length) {
    return <Alert variant="info">Upload dataset images first.</Alert>;
  }

  return (
    <Card>
      <CardHeader
        title="Test run"
        description="Quick single-image inference on the interactive queue (highest priority)."
      />

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Model</label>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} v{m.version}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Image</label>
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
        </div>

        <InferenceConfigFields
          confidence={confidence}
          iou={iou}
          onConfidenceChange={setConfidence}
          onIouChange={setIou}
        />

        <Button onClick={handleRun} loading={loading} disabled={!!jobId && !completedJob}>
          {!loading && <Play className="h-4 w-4" />}
          {loading ? "Submitting…" : "Run test"}
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
