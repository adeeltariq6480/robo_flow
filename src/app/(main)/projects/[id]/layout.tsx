import { Suspense } from "react";
import { ProjectLayoutShell } from "@/components/project/project-layout-shell";
import {
  ProjectHeader,
  ProjectHeaderSkeleton,
} from "@/components/project/project-header";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ProjectLayoutShell projectId={id}>
      <Suspense fallback={<ProjectHeaderSkeleton />}>
        <ProjectHeader projectId={id} />
      </Suspense>
      {children}
    </ProjectLayoutShell>
  );
}
