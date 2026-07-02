"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(100);
    const done = window.setTimeout(() => setProgress(0), 250);
    return () => window.clearTimeout(done);
  }, [pathname, searchParams]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-no-progress]")) return;

      const anchor = target.closest("a");
      const href = anchor?.getAttribute("href");
      if (
        !anchor ||
        !href ||
        !href.startsWith("/") ||
        href.startsWith("//") ||
        anchor.target === "_blank"
      ) {
        return;
      }

      const url = new URL(href, window.location.origin);
      const next = `${url.pathname}${url.search}`;
      const current = `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`;
      if (next === current) return;

      setProgress(14);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (progress <= 0 || progress >= 100) return;

    const interval = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 92) return p;
        return p + Math.random() * 10;
      });
    }, 300);

    return () => window.clearInterval(interval);
  }, [progress]);

  if (progress <= 0) return null;

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-0.5 bg-brand-100/80"
      aria-hidden
    >
      <div
        className="h-full bg-gradient-to-r from-brand-500 via-violet-500 to-brand-600 shadow-[0_0_8px_rgba(37,99,235,0.45)] transition-[width] duration-300 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
