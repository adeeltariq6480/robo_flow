"use client";

import { NavCard } from "@/components/ui/nav-card";

interface ProjectOverviewStatsProps {
  projectId: string;
  classCount: number;
  datasetCount: number;
  modelCount: number;
  imageCount: number;
}

export function ProjectOverviewStats({
  projectId,
  classCount,
  datasetCount,
  modelCount,
  imageCount,
}: ProjectOverviewStatsProps) {
  const items = [
    { label: "Classes", count: classCount, href: `/projects/${projectId}/classes` },
    { label: "Datasets", count: datasetCount, href: `/projects/${projectId}/datasets` },
    { label: "Models", count: modelCount, href: `/projects/${projectId}/models` },
    { label: "Images", count: imageCount, href: `/projects/${projectId}/datasets` },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <NavCard key={item.label} href={item.href}>
          <p className="text-sm text-slate-500">{item.label}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{item.count}</p>
        </NavCard>
      ))}
    </div>
  );
}
