"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LinkButton } from "@/components/ui/link-button";
import {
  deleteProject,
  deleteProjects,
  deleteAllProjects,
} from "@/lib/actions/projects";
import type { Project } from "@/lib/types/database";
import { Card } from "@/components/ui/card";
import { CardLoadingOverlay } from "@/components/ui/card-loading-overlay";
import { Alert } from "@/components/ui/alert";
import { BulkDeleteToolbar } from "@/components/ui/bulk-delete-toolbar";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { SimpleToast } from "@/components/ui/simple-toast";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { setDeleteStatus } from "@/lib/delete-status";
import { FolderKanban, Loader2, Plus, Trash2 } from "lucide-react";

interface ProjectsListClientProps {
  projects: Project[];
}

export function ProjectsListClient({ projects }: ProjectsListClientProps) {
  const router = useRouter();
  const { startNavigation, isPending } = useNavigationPending();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ open: boolean; message: string; type: "success" | "error" }>({
    open: false,
    message: "",
    type: "success",
  });
  const { confirm, dialog } = useConfirmDialog();

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
    if (!(await confirm({ title: "Delete projects?", message: `Delete ${selected.size} selected project(s)?` }))) return;
    setLoading(true);
    setDeleteStatus(true, "Deleting projects in background...");
    setError(null);
    const result = await deleteProjects(Array.from(selected));
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
      setToast({ open: true, message: "Projects deleted", type: "success" });
      setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
    }
    setLoading(false);
    setDeleteStatus(false);
  }

  async function handleDeleteAll() {
    if (!(await confirm({ title: "Delete all projects?", message: "Delete ALL projects?" }))) return;
    setLoading(true);
    setDeleteStatus(true, "Deleting all projects in background...");
    setError(null);
    const result = await deleteAllProjects();
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
      setToast({ open: true, message: "All projects deleted", type: "success" });
      setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
    }
    setLoading(false);
    setDeleteStatus(false);
  }

  async function handleDeleteOne(projectId: string) {
    if (!(await confirm({ title: "Delete project?", message: "Delete this project and all its data?" }))) return;
    setLoading(true);
    setDeletingId(projectId);
    setDeleteStatus(true, "Deleting project in background...");
    const result = await deleteProject(projectId);
    if (result?.error) {
      setError(result.error);
      setDeletingId(null);
      setLoading(false);
      setDeleteStatus(false);
    } else {
      setToast({ open: true, message: "Project deleted", type: "success" });
      setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
    }
  }

  return (
    <div className="animate-in">
      <SimpleToast open={toast.open} message={toast.message} type={toast.type} />
      {dialog}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 bg-clip-text text-2xl font-bold text-transparent">
            Projects
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage classes, datasets, and models — no login required
          </p>
        </div>
        <LinkButton href="/projects/new">
          <Plus className="h-4 w-4" />
          New project
        </LinkButton>
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
          <LinkButton href="/projects/new" className="mt-6">
            <Plus className="h-4 w-4" />
            Create project
          </LinkButton>
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
            {projects.map((project) => {
              const href = `/projects/${project.id}`;
              const isNavigating = isPending(href);
              return (
                <Card
                  key={project.id}
                  className={`group relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/10 ${
                    isNavigating ? "pointer-events-none ring-2 ring-brand-400/40" : ""
                  }`}
                >
                  {isNavigating && <CardLoadingOverlay />}
                  <div className="absolute right-3 top-3 z-20 flex items-center gap-1">
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
                  <Link
                    href={href}
                    className="block"
                    onClick={() => startNavigation(href)}
                  >
                    <div className="flex items-start gap-3 pr-16">
                      <div className="rounded-xl bg-gradient-to-br from-brand-50 to-indigo-50 p-2.5 shadow-inner transition-transform duration-300 group-hover:scale-105">
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
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
