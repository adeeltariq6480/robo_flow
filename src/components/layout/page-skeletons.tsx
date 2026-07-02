import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function ProjectsPageSkeleton() {
  return (
    <div className="animate-in fade-in duration-300">
      <div className="mb-8 flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      <div className="mb-4 flex gap-3">
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

export function ProjectOverviewSkeleton() {
  return (
    <div className="animate-in fade-in space-y-6 duration-300">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-16" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ListPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="animate-in fade-in space-y-6 duration-300">
      <Card>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
        <Skeleton className="mb-6 h-28 w-full rounded-xl" />
        <div className="mb-4 flex gap-2">
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 w-20 rounded-lg" />
        </div>
        <div className="max-h-[80vh] space-y-0 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-100">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20 rounded-lg" />
                <Skeleton className="h-9 w-20 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function GenericPageSkeleton() {
  return (
    <div className="animate-in fade-in space-y-6 duration-300">
      <Skeleton className="h-8 w-48" />
      <Card className="space-y-4">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </Card>
    </div>
  );
}
