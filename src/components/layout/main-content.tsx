"use client";

import { type ReactNode } from "react";
import { useNavigation } from "@/contexts/navigation-context";

export function MainContent({ children }: { children: ReactNode }) {
  const { isTransitioning, isExiting } = useNavigation();
  const dimmed = isTransitioning && !isExiting;

  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[1.75rem] border border-white/70 bg-white/35 p-4 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.25)] backdrop-blur-[2px] transition-[opacity,transform] duration-300 ease-out sm:p-5 lg:p-6 ${
        dimmed ? "pointer-events-none scale-[0.995] opacity-0" : "scale-100 opacity-100"
      }`}
    >
      {children}
    </div>
  );
}
