"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteModel } from "@/lib/actions/models";
import type { Model } from "@/lib/types/database";
import { formatBytes } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Box, Plus, Upload, Trash2 } from "lucide-react";

const FORMAT_LABELS: Record<string, string> = {
  onnx: "ONNX",
  pytorch: "PyTorch",
  tensorflow: "TensorFlow",
  tflite: "TFLite",
  other: "Other",
};

interface ModelsPageClientProps {
  projectId: string;
  models: Model[];
}

export function ModelsPageClient({ projectId, models }: ModelsPageClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleDelete(modelId: string) {
    if (!confirm("Delete this model?")) return;
    setLoading(true);
    const result = await deleteModel(projectId, modelId);
    if (result?.error) setError(result.error);
    else router.refresh();
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="Models"
          description="Uploaded model artifacts for inference and deployment."
          action={
            <Link href={`/projects/${projectId}/models/upload`}>
              <Button>
                <Plus className="h-4 w-4" />
                Upload model
              </Button>
            </Link>
          }
        />

        {models.length === 0 ? (
          <div className="text-center py-8">
            <Box className="mx-auto h-12 w-12 text-slate-300" />
            <p className="mt-4 text-sm text-slate-500">
              No models uploaded yet.
            </p>
            <Link
              href={`/projects/${projectId}/models/upload`}
              className="mt-4 inline-block"
            >
              <Button variant="secondary">
                <Upload className="h-4 w-4" />
                Upload your first model
              </Button>
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {models.map((model) => (
              <li
                key={model.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-amber-50 p-2">
                    <Box className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">
                      {model.name}{" "}
                      <span className="text-sm font-normal text-slate-400">
                        v{model.version}
                      </span>
                    </p>
                    <p className="text-sm text-slate-500">
                      {FORMAT_LABELS[model.format] ?? model.format} ·{" "}
                      {formatBytes(model.file_size)}
                    </p>
                    {model.description && (
                      <p className="mt-0.5 text-sm text-slate-400">
                        {model.description}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => handleDelete(model.id)}
                  disabled={loading}
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
