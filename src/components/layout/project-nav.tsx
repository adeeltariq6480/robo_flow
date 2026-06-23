"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, Tags, Database, Box } from "lucide-react";

const tabs = [
  { href: "", label: "Overview", icon: FolderKanban },
  { href: "/classes", label: "Classes", icon: Tags },
  { href: "/datasets", label: "Datasets", icon: Database },
  { href: "/models", label: "Models", icon: Box },
];

export function ProjectNav({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <div className="mb-8">
      <div className="mb-4">
        <Link
          href="/projects"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← All projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{projectName}</h1>
      </div>
      <nav className="flex gap-1 border-b border-slate-200">
        {tabs.map(({ href, label, icon: Icon }) => {
          const path = `${base}${href}`;
          const isActive =
            href === ""
              ? pathname === base
              : pathname.startsWith(path);

          return (
            <Link
              key={href}
              href={path}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
