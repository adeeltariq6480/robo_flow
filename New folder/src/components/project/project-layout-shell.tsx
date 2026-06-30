"use client";

import { ProjectDropProvider } from "@/components/project/project-drop-provider";

export function ProjectLayoutShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  return (
    <ProjectDropProvider projectId={projectId}>
      {children}
    </ProjectDropProvider>
  );
}
