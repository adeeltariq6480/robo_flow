"use client";

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

const projectLinks = [
  { suffix: "", label: "Overview", icon: LayoutDashboard },
  { suffix: "/classes", label: "Classes", icon: Tags },
  { suffix: "/datasets", label: "Datasets", icon: Database },
  { suffix: "/models", label: "Models", icon: Box },
  { suffix: "/inference", label: "Inference", icon: Zap },
];

const RESERVED_PROJECT_SEGMENTS = new Set(["new"]);

function resolveProjectId(pathname: string): string | undefined {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  const segment = match?.[1];
  if (!segment || RESERVED_PROJECT_SEGMENTS.has(segment)) return undefined;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      segment
    )
  ) {
    return undefined;
  }
  return segment;
}

export function AppSidebar() {
  const pathname = usePathname() ?? "";

  const projectId = resolveProjectId(pathname);
  const isNewProject = pathname === "/projects/new";

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? "bg-brand-600 text-white"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <Link href="/" className="flex h-16 items-center border-b border-slate-200 px-4">
        <LabelAILogo />
      </Link>

      <nav className="flex-1 space-y-1 p-4">
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
              Current project
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
