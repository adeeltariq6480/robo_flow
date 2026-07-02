"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function CardLoadingOverlay() {
  return (
    <div
      className="absolute inset-0 z-10 overflow-hidden rounded-xl border border-brand-200/60 bg-white/95 backdrop-blur-[2px]"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex h-full flex-col justify-center gap-3 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
