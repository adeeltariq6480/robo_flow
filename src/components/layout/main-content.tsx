"use client";

import { type ReactNode } from "react";
import { useNavigation } from "@/contexts/navigation-context";

export function MainContent({ children }: { children: ReactNode }) {
  const { isTransitioning, isExiting } = useNavigation();
  const dimmed = isTransitioning && !isExiting;

  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden transition-[opacity,transform] duration-300 ease-out ${
        dimmed ? "pointer-events-none scale-[0.995] opacity-0" : "scale-100 opacity-100"
      }`}
    >
      {children}
    </div>
  );
}
