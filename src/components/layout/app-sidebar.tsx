"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AxiomAILogo } from "@/components/layout/axiom-ai-logo";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { Skeleton } from "@/components/ui/skeleton";
import { getDeleteStatus } from "@/lib/delete-status";
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
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("axiomai-delete-status", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("axiomai-delete-status", sync as EventListener);
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
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
          active
            ? "bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-md shadow-brand-500/20"
            : loading
              ? "bg-slate-100 text-slate-800"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
    <aside className="flex h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-slate-200/80 bg-white shadow-sm">
      <Link
        href="/"
        onClick={() => startNavigation("/")}
        className="flex h-16 shrink-0 items-center border-b border-slate-200/80 px-4 transition-colors hover:bg-slate-50"
      >
        <AxiomAILogo />
      </Link>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
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

        {deleteBanner && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {deleteBanner}
          </div>
        )}
      </nav>
    </aside>
  );
}
