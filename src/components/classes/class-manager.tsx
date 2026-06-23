"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Class } from "@/lib/types/database";
import { createClass, updateClass, deleteClass } from "@/lib/actions/classes";
import { CLASS_COLORS } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Pencil, Trash2, Plus, X, Check } from "lucide-react";

interface ClassManagerProps {
  projectId: string;
  classes: Class[];
}

export function ClassManager({ projectId, classes }: ClassManagerProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function handleDelete(classId: string) {
    if (!confirm("Delete this class?")) return;
    setLoading(true);
    const result = await deleteClass(projectId, classId);
    if (result?.error) setError(result.error);
    else router.refresh();
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="Label classes"
          description="Define the object classes your model will detect or classify."
          action={
            !showForm && (
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4" />
                Add class
              </Button>
            )
          }
        />

        {showForm && (
          <form action={handleCreate} className="mb-6 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <ClassFormFields />
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                <Check className="h-4 w-4" />
                Save
              </Button>
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

        {classes.length === 0 ? (
          <p className="text-sm text-slate-500">
            No classes yet. Add your first label class to get started.
          </p>
        ) : (
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
                      <Button type="submit" disabled={loading}>
                        Save
                      </Button>
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
                    <div className="flex items-center gap-3">
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
                        onClick={() => handleDelete(cls.id)}
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
