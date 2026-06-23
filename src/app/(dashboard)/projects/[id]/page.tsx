import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProject } from "@/lib/server/auth";
import { Card } from "@/components/ui/card";
import { Tags, Database, Box, ArrowRight } from "lucide-react";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await requireProject(id);
  const supabase = await createClient();

  const [classesRes, datasetsRes, modelsRes] = await Promise.all([
    supabase.from("classes").select("id", { count: "exact", head: true }).eq("project_id", id),
    supabase.from("datasets").select("file_count").eq("project_id", id),
    supabase.from("models").select("id", { count: "exact", head: true }).eq("project_id", id),
  ]);

  const classCount = classesRes.count ?? 0;
  const datasetCount = datasetsRes.data?.length ?? 0;
  const modelCount = modelsRes.count ?? 0;
  const totalFiles =
    datasetsRes.data?.reduce((sum, d) => sum + d.file_count, 0) ?? 0;

  const sections = [
    {
      href: `/projects/${id}/classes`,
      icon: Tags,
      title: "Classes",
      count: classCount,
      description: "Label classes for detection",
      color: "bg-purple-50 text-purple-600",
    },
    {
      href: `/projects/${id}/datasets`,
      icon: Database,
      title: "Datasets",
      count: datasetCount,
      description: `${totalFiles} files across datasets`,
      color: "bg-green-50 text-green-600",
    },
    {
      href: `/projects/${id}/models`,
      icon: Box,
      title: "Models",
      count: modelCount,
      description: "Uploaded model artifacts",
      color: "bg-amber-50 text-amber-600",
    },
  ];

  return (
    <div className="space-y-6">
      {project.description && (
        <Card>
          <p className="text-slate-600">{project.description}</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {sections.map(({ href, icon: Icon, title, count, description, color }) => (
          <Link key={href} href={href}>
            <Card className="transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className={`rounded-lg p-2 ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-300" />
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
              <p className="mt-1 text-2xl font-bold text-slate-900">{count}</p>
              <p className="mt-1 text-sm text-slate-500">{description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
