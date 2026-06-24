import { getProject } from "@/lib/server/auth";
import * as projectService from "@/lib/services/projectService";
import Link from "next/link";
import { Card } from "@/components/ui/card";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  const stats = await projectService.getProjectStats(id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-slate-600">{project.description}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Classes", count: stats.classCount, href: `/projects/${id}/classes` },
          { label: "Datasets", count: stats.datasetCount, href: `/projects/${id}/datasets` },
          { label: "Models", count: stats.modelCount, href: `/projects/${id}/models` },
          { label: "Images", count: stats.imageCount, href: `/projects/${id}/datasets` },
        ].map((item) => (
          <Link key={item.label} href={item.href}>
            <Card className="transition-shadow hover:shadow-md">
              <p className="text-sm text-slate-500">{item.label}</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">{item.count}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
