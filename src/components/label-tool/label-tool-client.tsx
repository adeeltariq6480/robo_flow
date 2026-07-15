"use client";

import dynamic from "next/dynamic";
import type { Model } from "@/lib/types/database";

const ManualLabelTool = dynamic(
  () => import("@/components/label-tool/manual-label-tool").then((module) => module.ManualLabelTool),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[28rem] items-center justify-center rounded-3xl border border-slate-200 bg-white/70">
        <p className="text-sm font-medium text-slate-500">Loading Label Tool…</p>
      </div>
    ),
  }
);

export function LabelToolClient({ projectId, models }: { projectId: string; models: Model[] }) {
  return <ManualLabelTool projectId={projectId} models={models} />;
}
