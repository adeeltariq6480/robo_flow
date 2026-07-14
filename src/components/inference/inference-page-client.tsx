"use client";

import { useState } from "react";
import type { Model, Dataset } from "@/lib/types/database";
import { TestRunPanel, type DatasetFileOption } from "@/components/inference/test-run-panel";
import { AutoLabelPanel } from "@/components/inference/auto-label-panel";
import { ModelComparePanel } from "@/components/inference/model-compare-panel";
import { Play, Tags, GitCompare } from "lucide-react";

type Tab = "test-run" | "auto-label" | "compare";

const tabs: { id: Tab; label: string; icon: typeof Play }[] = [
  { id: "test-run", label: "Test run", icon: Play },
  { id: "auto-label", label: "Auto-label", icon: Tags },
  { id: "compare", label: "Compare", icon: GitCompare },
];

interface InferencePageClientProps {
  projectId: string;
  models: Model[];
  datasets: Dataset[];
  files: DatasetFileOption[];
}

export function InferencePageClient({
  projectId,
  models,
  datasets,
  files,
}: InferencePageClientProps) {
  const [tab, setTab] = useState<Tab>("test-run");

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900">YOLO Inference</h2>
        <p className="mt-1 text-sm text-slate-500">
          Test run &amp; model compare run on Railway. Full auto-label uses Google Colab
          when RUN_AUTO_LABEL_WORKER=false.
        </p>
      </div>

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              tab === id
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "test-run" && (
        <TestRunPanel projectId={projectId} models={models} files={files} />
      )}
      {tab === "auto-label" && (
        <AutoLabelPanel projectId={projectId} models={models} datasets={datasets} />
      )}
      {tab === "compare" && (
        <ModelComparePanel projectId={projectId} models={models} files={files} />
      )}
    </div>
  );
}
