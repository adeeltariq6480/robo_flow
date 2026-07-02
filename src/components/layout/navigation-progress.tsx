"use client";

import { useNavigation } from "@/contexts/navigation-context";

export function NavigationProgress() {
  const { isTransitioning, isExiting, progress } = useNavigation();

  if (!isTransitioning) return null;

  return (
    <div
      className={`pointer-events-none fixed left-0 right-0 top-0 z-[100] h-[3px] overflow-hidden bg-brand-100/60 ${
        isExiting ? "nav-bar-exit" : "nav-bar-enter"
      }`}
      aria-hidden
    >
      <div
        className="nav-progress-bar h-full origin-left bg-gradient-to-r from-brand-500 via-violet-500 to-brand-600 shadow-[0_0_12px_rgba(37,99,235,0.45)]"
        style={{ transform: `scaleX(${Math.max(0.02, progress / 100)})` }}
      />
    </div>
  );
}
