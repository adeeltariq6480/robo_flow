"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AxiomAILogo } from "@/components/layout/axiom-ai-logo";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { Skeleton } from "@/components/ui/skeleton";
import { getDeleteStatus } from "@/lib/delete-status";
import { getCsvDownloadStatus } from "@/lib/csv-download-status";
import { resumeStockCsvDownloads } from "@/lib/csv-download-job";
import {
  FolderKanban,
  Plus,
  Tags,
  Database,
  Box,
  LayoutDashboard,
  Zap,
  Sparkles,
  ClipboardList,
  Scissors,
  ListChecks,
} from "lucide-react";
import { readActiveInferenceJob } from "@/lib/inference/active-job";

const LAST_PROJECT_KEY = "axiomai:lastProjectId";

const projectLinks = [
  { suffix: "", label: "Overview", icon: LayoutDashboard },
  { suffix: "/classes", label: "Classes", icon: Tags },
  { suffix: "/models", label: "Models", icon: Box },
  { suffix: "/datasets", label: "Datasets", icon: Database },
  { suffix: "/inference", label: "Inference", icon: Zap },
  { suffix: "/inventory", label: "Stock check", icon: ClipboardList },
  { suffix: "/stock-check-lotte", label: "Stock Check Lotte", icon: ListChecks },
  { suffix: "/label-tool", label: "Label tool", icon: Scissors },
];

const RESERVED_PROJECT_SEGMENTS = new Set(["new"]);

function resolveProjectId(pathname: string): string | undefined {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  const segment = match?.[1];
  if (!segment || RESERVED_PROJECT_SEGMENTS.has(segment)) return undefined;
  return decodeURIComponent(segment);
}

export function AppSidebar() {
  const pathname = usePathname() ?? "";
  const { startNavigation, isPending } = useNavigationPending();

  const activeProjectId = resolveProjectId(pathname);
  const isNewProject = pathname === "/projects/new";

  const [lastProjectId, setLastProjectId] = useState<string | undefined>();
  const [activeLabelHref, setActiveLabelHref] = useState<string | null>(null);
  const [deleteBanner, setDeleteBanner] = useState<string | null>(null);
  const [downloadBanner, setDownloadBanner] = useState<string | null>(null);

  useEffect(() => {
    if (activeProjectId) {
      setLastProjectId(activeProjectId);
      try {
        localStorage.setItem(LAST_PROJECT_KEY, activeProjectId);
      } catch {
        /* ignore */
      }
    } else {
      try {
        const stored = localStorage.getItem(LAST_PROJECT_KEY);
        if (stored) setLastProjectId(stored);
      } catch {
        /* ignore */
      }
    }
  }, [activeProjectId]);

  useEffect(() => {
    try {
      const update = () => {
        const active = readActiveInferenceJob();
        if (!active) {
          setActiveLabelHref(null);
          return;
        }
        setActiveLabelHref(
          `/projects/${active.projectId}/datasets/${active.datasetId}/label`
        );
      };
      update();
      window.addEventListener("focus", update);
      window.addEventListener("storage", update);
      return () => {
        window.removeEventListener("focus", update);
        window.removeEventListener("storage", update);
      };
    } catch {
      setActiveLabelHref(null);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const s = getDeleteStatus();
      setDeleteBanner(s?.active ? s.label : null);
      const d = getCsvDownloadStatus();
      setDownloadBanner(d?.active ? d.label : null);
    };
    sync();
    resumeStockCsvDownloads();
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("axiomai-delete-status", sync as EventListener);
    window.addEventListener("axiomai-csv-download-status", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("axiomai-delete-status", sync as EventListener);
      window.removeEventListener(
        "axiomai-csv-download-status",
        sync as EventListener
      );
    };
  }, []);

  const projectId = activeProjectId ?? lastProjectId;

  function navLink(
    href: string,
    active: boolean,
    icon: React.ReactNode,
    label: string
  ) {
    const loading = isPending(href);
    return (
      <Link
        key={href}
        href={href}
        prefetch
        onClick={() => startNavigation(href)}
        aria-busy={loading}
        className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
          active
            ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-lg shadow-emerald-500/20"
            : loading
              ? "bg-emerald-50 text-emerald-800"
              : "text-slate-600 hover:translate-x-0.5 hover:bg-white/80 hover:text-emerald-800 hover:shadow-sm"
        }`}
      >
        {loading ? (
          <Skeleton className="h-4 w-4 shrink-0 rounded" />
        ) : (
          icon
        )}
        <span className={loading ? "opacity-70" : undefined}>{label}</span>
      </Link>
    );
  }

  return (
    <aside className="m-3 mr-0 flex h-[calc(100dvh-1.5rem)] w-64 shrink-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/75 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/60 backdrop-blur-xl">
      <Link
        href="/"
        onClick={() => startNavigation("/")}
        className="flex h-16 shrink-0 items-center border-b border-slate-200/60 bg-gradient-to-r from-emerald-50/70 via-white to-cyan-50/60 px-4 transition-colors hover:from-emerald-100/60 hover:to-cyan-100/50"
      >
        <AxiomAILogo />
      </Link>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3.5">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Main
        </p>
        {navLink("/", pathname === "/", <FolderKanban className="h-4 w-4" />, "Projects")}
        {navLink(
          "/projects/new",
          isNewProject,
          <Plus className="h-4 w-4" />,
          "New project"
        )}

        {projectId && (
          <>
            <p className="mb-2 mt-6 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {activeProjectId ? "Current project" : "Recent project"}
            </p>
            {projectLinks.map(({ suffix, label, icon: Icon }) => {
              const href = `/projects/${projectId}${suffix}`;
              const active =
                suffix === ""
                  ? pathname === href
                  : pathname.startsWith(href);
              return navLink(
                href,
                active,
                <Icon className="h-4 w-4" />,
                label
              );
            })}
            {activeLabelHref &&
              navLink(
                activeLabelHref,
                pathname.startsWith(activeLabelHref),
                <Sparkles className="h-4 w-4" />,
                "Labeling"
              )}
          </>
        )}

        {downloadBanner && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            {downloadBanner}
          </div>
        )}
        {deleteBanner && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {deleteBanner}
          </div>
        )}
      </nav>
    </aside>
  );
}
