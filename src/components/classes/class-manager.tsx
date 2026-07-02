"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Class } from "@/lib/types/database";
import {
  createClass,
  createClassesBulk,
  updateClass,
  deleteClass,
  deleteClasses,
  deleteAllClasses,
} from "@/lib/actions/classes";
import { useProjectDrop } from "@/components/project/project-drop-provider";
import { readFileAsText } from "@/lib/upload/classify-files";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { CLASS_COLORS } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { BulkDeleteToolbar } from "@/components/ui/bulk-delete-toolbar";
import { SimpleToast } from "@/components/ui/simple-toast";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { setDeleteStatus } from "@/lib/delete-status";
import { Pencil, Trash2, Plus, X, Check, ListPlus } from "lucide-react";

interface ClassManagerProps {
  projectId: string;
  classes: Class[];
}

export function ClassManager({ projectId, classes }: ClassManagerProps) {
  const router = useRouter();
  const projectDrop = useProjectDrop();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ open: boolean; message: string; type: "success" | "error" }>({
    open: false,
    message: "",
    type: "success",
  });
  const { confirm, dialog } = useConfirmDialog();

  const allSelected = classes.length > 0 && selected.size === classes.length;

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
    else setSelected(new Set(classes.map((c) => c.id)));
  }

  const importClassFiles = useCallback(
    async (files: File[]) => {
      setLoading(true);
      setError(null);
      try {
        const parts = await Promise.all(files.map((f) => readFileAsText(f)));
        const fd = new FormData();
        fd.set("names", parts.join("\n"));
        const result = await createClassesBulk(projectId, fd);
        if (result?.error) setError(result.error);
        else router.refresh();
      } catch {
        setError("Could not read class list file");
      }
      setLoading(false);
    },
    [projectId, router]
  );

  useEffect(() => {
    if (!projectDrop) return;
    return projectDrop.registerHandler("classes", importClassFiles);
  }, [projectDrop, importClassFiles]);

  async function handleCreate(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await createClass(projectId, formData);
    if (result?.error) {
      setError(result.error);
    } else {
      setShowForm(false);
      router.refresh();
    }
    setLoading(false);
  }

  async function handleBulkCreate(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await createClassesBulk(projectId, formData);
    if (result?.error) {
      setError(result.error);
    } else {
      setShowBulkForm(false);
      router.refresh();
    }
    setLoading(false);
  }

  async function handleUpdate(classId: string, formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await updateClass(projectId, classId, formData);
    if (result?.error) {
      setError(result.error);
    } else {
      setEditingId(null);
      router.refresh();
    }
    setLoading(false);
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!(await confirm({ title: "Delete classes?", message: `Delete ${selected.size} selected class(es)?` }))) return;
    setLoading(true);
    setDeleteStatus(true, "Deleting classes in background...");
    const result = await deleteClasses(projectId, Array.from(selected));
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
      setToast({ open: true, message: "Classes deleted", type: "success" });
      setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
    }
    setLoading(false);
    setDeleteStatus(false);
  }

  async function handleDeleteAll() {
    if (!(await confirm({ title: "Delete all classes?", message: "Delete ALL classes in this project?" }))) return;
    setLoading(true);
    setDeleteStatus(true, "Deleting all classes in background...");
    const result = await deleteAllClasses(projectId);
    if (result?.error) setError(result.error);
    else {
      setSelected(new Set());
      router.refresh();
      setToast({ open: true, message: "All classes deleted", type: "success" });
      setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
    }
    setLoading(false);
    setDeleteStatus(false);
  }

  async function handleDeleteOne(classId: string) {
    if (!(await confirm({ title: "Delete class?", message: "Delete this class?" }))) return;
    setLoading(true);
    setDeleteStatus(true, "Deleting class in background...");
    const result = await deleteClass(projectId, classId);
    if (result?.error) setError(result.error);
    else {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(classId);
        return next;
      });
      router.refresh();
      setToast({ open: true, message: "Class deleted", type: "success" });
      setTimeout(() => setToast((t) => ({ ...t, open: false })), 2200);
    }
    setLoading(false);
    setDeleteStatus(false);
  }

  return (
    <div className="space-y-6">
      <SimpleToast open={toast.open} message={toast.message} type={toast.type} />
      {dialog}
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="Label classes"
          description="Define object classes. Add one at a time or paste an array of names."
          action={
            !showForm &&
            !showBulkForm && (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setShowBulkForm(true)}>
                  <ListPlus className="h-4 w-4" />
                  Add array
                </Button>
                <Button onClick={() => setShowForm(true)}>
                  <Plus className="h-4 w-4" />
                  Add class
                </Button>
              </div>
            )
          }
        />

        <FileDropZone
          onFiles={importClassFiles}
          disabled={loading}
          uploading={loading}
          progress={loading ? 50 : 0}
          progressLabel="Importing classes…"
          progressSublabel="Reading file and saving to project"
          multiple
          accept=".txt,.json,.csv"
          className="mb-6"
          hint="Drag & drop class list file"
          subhint=".txt, .json, or .csv — one name per line"
        />

        {showBulkForm && (
          <form
            action={handleBulkCreate}
            className="mb-6 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <Textarea
              label="Class names (array)"
              name="names"
              rows={6}
              placeholder={`One per line:\ndefect\nperson\nbolt\n\nOr comma-separated: defect, person, bolt\n\nOr JSON: ["defect", "person", "bolt"]`}
              required
              autoFocus
            />
            <div className="flex gap-2">
              <SubmitButton pendingLabel="Adding…">
                <Check className="h-4 w-4" />
                Add all
              </SubmitButton>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowBulkForm(false)}
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          </form>
        )}

        {showForm && (
          <form
            action={handleCreate}
            className="mb-6 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <ClassFormFields />
            <div className="flex gap-2">
              <SubmitButton pendingLabel="Saving…">
                <Check className="h-4 w-4" />
                Save
              </SubmitButton>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowForm(false)}
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          </form>
        )}

        <BulkDeleteToolbar
          itemLabel="classes"
          totalCount={classes.length}
          selectedCount={selected.size}
          onDeleteSelected={handleDeleteSelected}
          onDeleteAll={handleDeleteAll}
          disabled={loading}
          loading={loading}
          allSelected={allSelected}
          onToggleSelectAll={toggleSelectAll}
        />

        {classes.length === 0 ? (
          <p className="text-sm text-slate-500">
            No classes yet. Add your first label class to get started.
          </p>
        ) : (
          <div className="max-h-[80vh] overflow-y-auto">
            <ul className="divide-y divide-slate-100">
            {classes.map((cls) => (
              <li key={cls.id} className="py-4">
                {editingId === cls.id ? (
                  <form
                    action={(fd) => handleUpdate(cls.id, fd)}
                    className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
                  >
                    <ClassFormFields
                      defaultName={cls.name}
                      defaultDescription={cls.description ?? ""}
                      defaultColor={cls.color}
                    />
                    <div className="flex gap-2">
                      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(cls.id)}
                        onChange={() => toggleSelect(cls.id)}
                        disabled={loading}
                        className="rounded border-slate-300"
                      />
                      <span
                        className="h-4 w-4 shrink-0 rounded-full"
                        style={{ backgroundColor: cls.color }}
                      />
                      <div>
                        <p className="font-medium text-slate-900">{cls.name}</p>
                        {cls.description && (
                          <p className="text-sm text-slate-500">{cls.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => setEditingId(cls.id)}
                        disabled={loading}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleDeleteOne(cls.id)}
                        disabled={loading}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

function ClassFormFields({
  defaultName = "",
  defaultDescription = "",
  defaultColor = CLASS_COLORS[0],
}: {
  defaultName?: string;
  defaultDescription?: string;
  defaultColor?: string;
}) {
  return (
    <>
      <Input
        label="Class name"
        name="name"
        defaultValue={defaultName}
        placeholder="e.g. defect, person, bolt"
        required
      />
      <Textarea
        label="Description (optional)"
        name="description"
        defaultValue={defaultDescription}
        rows={2}
        placeholder="What does this class represent?"
      />
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">Color</label>
        <div className="flex flex-wrap gap-2">
          {CLASS_COLORS.map((color) => (
            <label key={color} className="cursor-pointer">
              <input
                type="radio"
                name="color"
                value={color}
                defaultChecked={color === defaultColor}
                className="sr-only peer"
              />
              <span
                className="block h-8 w-8 rounded-full border-2 border-transparent peer-checked:border-slate-900 peer-checked:ring-2 peer-checked:ring-offset-2"
                style={{ backgroundColor: color }}
              />
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
