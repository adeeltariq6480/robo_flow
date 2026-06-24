import { getProject } from "@/lib/server/auth";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{project.name}</h1>
      {project.description && (
        <p className="mb-6 text-sm text-slate-500">{project.description}</p>
      )}
      {children}
    </div>
  );
}
