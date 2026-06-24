"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setLoading(false);
    setProgress(100);
    const t = window.setTimeout(() => setProgress(0), 200);
    return () => window.clearTimeout(t);
  }, [pathname, searchParams]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      if (anchor.target === "_blank") return;

      const url = new URL(href, window.location.origin);
      const next = `${url.pathname}${url.search}`;
      const current = `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`;
      if (next === current) return;

      startTransition(() => {
        setLoading(true);
        setProgress(12);
      });
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, searchParams, startTransition]);

  useEffect(() => {
    if (!loading) return;

    setProgress(18);
    const interval = window.setInterval(() => {
      setProgress((p) => (p >= 92 ? p : p + Math.random() * 8));
    }, 280);

    return () => window.clearInterval(interval);
  }, [loading]);

  if (progress <= 0 && !loading) return null;

  return (
    <>
      <div
        className="fixed left-0 right-0 top-0 z-[100] h-1 bg-brand-100"
        aria-hidden
      >
        <div
          className="h-full bg-brand-600 transition-[width] duration-300 ease-out"
          style={{ width: `${loading ? progress : 100}%` }}
        />
      </div>
      {loading && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-white/40 backdrop-blur-[1px]"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-lg">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            <span className="text-sm font-medium text-slate-700">Loading page…</span>
          </div>
        </div>
      )}
    </>
  );
}
