import { getProject } from "@/lib/server/auth";
import { ProjectLayoutShell } from "@/components/project/project-layout-shell";
import { runBackendPage } from "@/lib/server/backend-page";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return runBackendPage(async () => {
    const project = await getProject(id);

    return (
      <ProjectLayoutShell projectId={id}>
        <h1 className="mb-2 text-2xl font-bold text-slate-900">{project.name}</h1>
        {project.description && (
          <p className="mb-6 text-sm text-slate-500">{project.description}</p>
        )}
        {children}
      </ProjectLayoutShell>
    );
  });
}
