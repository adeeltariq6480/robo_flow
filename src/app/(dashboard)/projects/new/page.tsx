"use client";

import { useState } from "react";
import Link from "next/link";
import { createProject } from "@/lib/actions/projects";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default function NewProjectPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await createProject(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <Link
          href="/projects"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">New project</h1>
        <p className="mt-1 text-sm text-slate-500">
          A project groups your classes, datasets, and models together.
        </p>
      </div>

      <Card>
        {error && (
          <div className="mb-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <form action={handleSubmit} className="space-y-4">
          <Input
            label="Project name"
            name="name"
            placeholder="e.g. Assembly Line QC"
            required
            autoFocus
          />
          <Textarea
            label="Description (optional)"
            name="description"
            rows={3}
            placeholder="What is this project for?"
          />
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create project"}
            </Button>
            <Link href="/projects">
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
