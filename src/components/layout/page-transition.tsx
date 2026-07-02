"use client";

import { useNavigation } from "@/contexts/navigation-context";
import {
  GenericPageSkeleton,
  ListPageSkeleton,
  ProjectOverviewSkeleton,
  ProjectsPageSkeleton,
} from "@/components/layout/page-skeletons";

function skeletonForHref(href: string | null) {
  if (!href || href === "/") return <ProjectsPageSkeleton />;

  const path = href.split("?")[0] ?? href;

  if (/^\/projects\/[^/]+$/.test(path)) return <ProjectOverviewSkeleton />;
  if (
    path.includes("/classes") ||
    path.includes("/models") ||
    (path.includes("/datasets") && !path.includes("/datasets/"))
  ) {
    return <ListPageSkeleton />;
  }

  return <GenericPageSkeleton />;
}

export function PageTransition() {
  const { isTransitioning, isExiting, targetHref } = useNavigation();

  if (!isTransitioning) return null;

  return (
    <div
      className={`nav-overlay absolute inset-0 z-30 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 ${
        isExiting ? "nav-overlay-exit" : "nav-overlay-enter"
      }`}
      aria-busy={!isExiting}
      aria-live="polite"
      aria-label="Loading page"
    >
      <div className="h-full overflow-y-auto overflow-x-hidden">
        {skeletonForHref(targetHref)}
      </div>
    </div>
  );
}
