"use client";

import { useState } from "react";
import { deleteHfCleanup, previewHfCleanup } from "@/lib/worker/client";

const DEFAULT_REPO_ID = "Adeel6480/robo_flow";

export default function HfCleanupPage() {
  const [repoId, setRepoId] = useState(DEFAULT_REPO_ID);
  const [repoType, setRepoType] = useState("dataset");
  const [files, setFiles] = useState<string[] | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleteResult, setDeleteResult] = useState<{
    deleted_count: number;
    deleted_files: string[];
    message?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);

  const canDelete = confirmation === "DELETE";

  async function handlePreview() {
    setError(null);
    setDeleteResult(null);
    setPreviewMessage(null);
    setFiles(null);
    setLoadingPreview(true);

    try {
      const result = await previewHfCleanup(repoId, repoType);
      setFiles(result.files || []);
      setPreviewMessage(result.message ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleteResult(null);
    setLoadingDelete(true);

    try {
      const result = await deleteHfCleanup({
        repo_id: repoId,
        repo_type: repoType,
        confirmation,
      });
      setDeleteResult(result);
      setFiles(result.deleted_files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoadingDelete(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-slate-900">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold">Temporary Hugging Face Cleanup</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Remove this page after cleanup is complete.
        </p>

        <div className="mt-8 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700">Hugging Face repo ID</label>
            <input
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-sky-500 focus:outline-none"
              value={repoId}
              onChange={(event) => setRepoId(event.target.value)}
              placeholder="owner/repo"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Repo type</label>
            <select
              value={repoType}
              onChange={(event) => setRepoType(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-sky-500 focus:outline-none"
            >
              <option value="dataset">dataset</option>
              <option value="model">model</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handlePreview}
            className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={loadingPreview}
          >
            {loadingPreview ? "Previewing…" : "Preview Files"}
          </button>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {previewMessage ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {previewMessage}
            </div>
          ) : null}

          {files && (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Files found ({files.length})</p>
                  <p className="mt-1 text-sm text-slate-600">
                    This will delete all files inside the repo but will NOT delete the repo itself.
                  </p>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
                {files.length === 0 ? (
                  <p>No files found.</p>
                ) : (
                  <ul className="space-y-2">
                    {files.map((file) => (
                      <li key={file} className="rounded-xl border border-slate-200 px-3 py-2">
                        {file}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {files && files.length > 0 ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-6">
              <p className="text-base font-semibold text-red-900">Danger zone</p>
              <p className="mt-2 text-sm leading-6 text-red-700">
                Type <span className="font-semibold">DELETE</span> below to enable the delete button.
              </p>

              <div className="mt-4 space-y-4">
                <input
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-red-500 focus:outline-none"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="Type DELETE to confirm"
                />
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!canDelete || loadingDelete}
                  className="inline-flex items-center justify-center rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loadingDelete ? "Deleting…" : "Delete Repo Contents"}
                </button>
              </div>
            </div>
          ) : null}

          {deleteResult ? (
            <div className="rounded-3xl border border-green-200 bg-emerald-50 p-5 text-sm text-slate-900">
              <p className="font-semibold text-emerald-900">Cleanup completed</p>
              <p className="mt-2">Deleted files: {deleteResult.deleted_count}</p>
              <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
                <ul className="space-y-2">
                  {deleteResult.deleted_files.map((file) => (
                    <li key={file} className="truncate text-slate-700">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
