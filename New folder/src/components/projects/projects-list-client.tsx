"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteProject,
  deleteProjects,
  deleteAllProjects,
} from "@/lib/actions/projects";
import type { Project } from "@/lib/types/database";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { BulkDeleteToolbar } from "@/components/ui/bulk-delete-toolbar";
import { FolderKanban, Loader2, Plus, Trash2 } from "lucide-react";

interface ProjectsListClientProps {
  projects: Project[];
}

export function ProjectsListClient({ projects }: ProjectsListClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = projects.length > 0 && selected.size === projects.length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(projects.map((p) => p.id)));
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected project(s)?`)) return;
    setLoading(true);
    setError(null);
    const result = await deleteProjects(Array.from(selected));
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoading(false);
  }

  async function handleDeleteAll() {
    if (!confirm("Delete ALL projects?")) return;
    setLoading(true);
    setError(null);
    const result = await deleteAllProjects();
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
    }
    setLoading(false);
  }

  async function handleDeleteOne(projectId: string) {
    if (!confirm("Delete this project and all its data?")) return;
    setLoading(true);
    setDeletingId(projectId);
    const result = await deleteProject(projectId);
    if (result?.error) {
      setError(result.error);
      setDeletingId(null);
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage classes, datasets, and models — no login required
          </p>
        </div>
        <Link href="/projects/new">
          <Button>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        </Link>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {!projects.length ? (
        <Card className="py-12 text-center">
          <FolderKanban className="mx-auto h-12 w-12 text-slate-300" />
          <h2 className="mt-4 text-lg font-medium text-slate-900">No projects yet</h2>
          <p className="mt-2 text-sm text-slate-500">
            Create your first project to get started.
          </p>
          <Link href="/projects/new" className="mt-6 inline-block">
            <Button>
              <Plus className="h-4 w-4" />
              Create project
            </Button>
          </Link>
        </Card>
      ) : (
        <>
          <BulkDeleteToolbar
            itemLabel="projects"
            totalCount={projects.length}
            selectedCount={selected.size}
            onDeleteSelected={handleDeleteSelected}
            onDeleteAll={handleDeleteAll}
            disabled={loading}
            loading={loading}
            allSelected={allSelected}
            onToggleSelectAll={toggleSelectAll}
          />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Card key={project.id} className="relative transition-shadow hover:shadow-md">
                <div className="absolute right-3 top-3 flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selected.has(project.id)}
                    onChange={() => toggleSelect(project.id)}
                    disabled={loading}
                    className="rounded border-slate-300"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onClick={() => handleDeleteOne(project.id)}
                    disabled={loading}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Delete project"
                  >
                    {deletingId === project.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Link href={`/projects/${project.id}`} className="block">
                  <div className="flex items-start gap-3 pr-16">
                    <div className="rounded-lg bg-brand-50 p-2">
                      <FolderKanban className="h-5 w-5 text-brand-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold text-slate-900">
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                          {project.description}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-slate-400">
                        Updated {new Date(project.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
