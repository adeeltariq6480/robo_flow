import { getProject } from "@/lib/server/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { backendErrorPage } from "@/lib/server/backend-page";

export async function ProjectHeader({ projectId }: { projectId: string }) {
  try {
    const project = await getProject(projectId);
    return (
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-sm text-slate-500">{project.description}</p>
        )}
      </div>
    );
  } catch (err) {
    const page = backendErrorPage(err);
    if (page) return page;
    throw err;
  }
}

export function ProjectHeaderSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}
