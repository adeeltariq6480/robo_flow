import { requireProject } from "@/lib/server/auth";
import { ProjectNav } from "@/components/layout/project-nav";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await requireProject(id);

  return (
    <div>
      <ProjectNav projectId={id} projectName={project.name} />
      {children}
    </div>
  );
}
