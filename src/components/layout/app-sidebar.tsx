"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LabelAILogo } from "@/components/layout/label-ai-logo";
import {
  FolderKanban,
  Plus,
  Tags,
  Database,
  Box,
  LayoutDashboard,
  Zap,
} from "lucide-react";

const LAST_PROJECT_KEY = "labelai:lastProjectId";

const projectLinks = [
  { suffix: "", label: "Overview", icon: LayoutDashboard },
  { suffix: "/classes", label: "Classes", icon: Tags },
  { suffix: "/models", label: "Models", icon: Box },
  { suffix: "/datasets", label: "Datasets", icon: Database },
  { suffix: "/inference", label: "Inference", icon: Zap },
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

  const activeProjectId = resolveProjectId(pathname);
  const isNewProject = pathname === "/projects/new";

  const [lastProjectId, setLastProjectId] = useState<string | undefined>();

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

  const projectId = activeProjectId ?? lastProjectId;

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? "bg-brand-600 text-white"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  return (
    <aside className="flex h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
      <Link href="/" className="flex h-16 shrink-0 items-center border-b border-slate-200 px-4">
        <LabelAILogo />
      </Link>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Main
        </p>
        <Link href="/" className={linkClass(pathname === "/")}>
          <FolderKanban className="h-4 w-4" />
          Projects
        </Link>
        <Link href="/projects/new" className={linkClass(isNewProject)}>
          <Plus className="h-4 w-4" />
          New project
        </Link>

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
              return (
                <Link key={suffix} href={href} className={linkClass(active)}>
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
