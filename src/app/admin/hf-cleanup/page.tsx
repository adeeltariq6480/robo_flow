"use client";

import { useState } from "react";
import {
  deleteHfCleanup,
  deleteHfRepo,
  previewHfCleanup,
} from "@/lib/worker/client";

const DEFAULT_REPO_ID = "Adeel6480/robo-flow-datasets";

export default function HfCleanupPage() {
  const [repoId, setRepoId] = useState(DEFAULT_REPO_ID);
  const [repoType, setRepoType] = useState("dataset");
  const [files, setFiles] = useState<string[] | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [fileConfirmation, setFileConfirmation] = useState("");
  const [repoConfirmation, setRepoConfirmation] = useState("");
  const [deleteResult, setDeleteResult] = useState<{
    deleted_count: number;
    deleted_files: string[];
    message?: string;
  } | null>(null);
  const [deleteRepoResult, setDeleteRepoResult] = useState<{
    deleted_repo: string;
    message?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);
  const [loadingDeleteRepo, setLoadingDeleteRepo] = useState(false);

  const canDeleteFiles = fileConfirmation === "DELETE";
  const canDeleteRepo =
    repoConfirmation.trim() === repoId.trim() && repoId.trim().length > 0;

  async function handlePreview() {
    setError(null);
    setDeleteResult(null);
    setDeleteRepoResult(null);
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

  async function handleDeleteFiles() {
    setError(null);
    setDeleteResult(null);
    setLoadingDelete(true);

    try {
      const result = await deleteHfCleanup({
        repo_id: repoId,
        repo_type: repoType,
        confirmation: fileConfirmation,
      });
      setDeleteResult(result);
      setFiles(result.deleted_files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoadingDelete(false);
    }
  }

  async function handleDeleteRepo() {
    setError(null);
    setDeleteRepoResult(null);
    setLoadingDeleteRepo(true);

    try {
      const result = await deleteHfRepo({
        repo_id: repoId,
        repo_type: repoType,
        confirmation: repoConfirmation.trim(),
      });
      setDeleteRepoResult({
        deleted_repo: result.deleted_repo,
        message: result.message,
      });
      setFiles([]);
      setPreviewMessage("Repository removed from Hugging Face.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repo delete failed");
    } finally {
      setLoadingDeleteRepo(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-slate-900">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold">Hugging Face Cleanup</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Delete files inside a repo, or permanently remove an entire repository
          (e.g. extra <code className="text-xs">robo-flow-datasets</code>).{" "}
          Keep <strong>Adeel6480/robo_flow</strong> — that is your main dataset repo for images.
        </p>

        <div className="mt-8 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Hugging Face repo ID
            </label>
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
            <p className="mt-2 text-xs text-slate-500">
              <code>robo-flow-datasets</code> → old extra repo · <code>robo_flow</code> → dataset (images + models)
            </p>
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
              <p className="text-sm font-semibold text-slate-900">
                Files found ({files.length})
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Option 1 below clears files but keeps the empty repo on Hugging Face.
              </p>

              <div className="mt-4 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
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
            <div className="rounded-3xl border border-orange-200 bg-orange-50 p-6">
              <p className="text-base font-semibold text-orange-900">
                Option 1 — Delete repo contents only
              </p>
              <p className="mt-2 text-sm leading-6 text-orange-800">
                Removes all files. The repo shell stays on Hugging Face. Type{" "}
                <span className="font-semibold">DELETE</span> to confirm.
              </p>

              <div className="mt-4 space-y-4">
                <input
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-orange-500 focus:outline-none"
                  value={fileConfirmation}
                  onChange={(event) => setFileConfirmation(event.target.value)}
                  placeholder="Type DELETE to confirm"
                />
                <button
                  type="button"
                  onClick={handleDeleteFiles}
                  disabled={!canDeleteFiles || loadingDelete}
                  className="inline-flex items-center justify-center rounded-xl bg-orange-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loadingDelete ? "Deleting files…" : "Delete repo contents"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-red-300 bg-red-50 p-6">
            <p className="text-base font-semibold text-red-900">
              Option 2 — Delete entire repository (permanent)
            </p>
            <p className="mt-2 text-sm leading-6 text-red-800">
              This removes <strong>{repoId || "the repo"}</strong> completely from Hugging
              Face. Cannot be undone. The worker blocks deletion if this repo is still set
              in Railway <code className="text-xs">HF_DATASET_REPO</code> /{" "}
              <code className="text-xs">HF_MODEL_REPO</code>.
            </p>
            <p className="mt-2 text-sm text-red-700">
              Type the exact repo id below to confirm:
            </p>

            <div className="mt-4 space-y-4">
              <input
                className="w-full rounded-xl border border-red-300 px-4 py-3 text-sm shadow-sm focus:border-red-600 focus:outline-none"
                value={repoConfirmation}
                onChange={(event) => setRepoConfirmation(event.target.value)}
                placeholder={repoId || "owner/repo"}
              />
              <button
                type="button"
                onClick={handleDeleteRepo}
                disabled={!canDeleteRepo || loadingDeleteRepo}
                className="inline-flex items-center justify-center rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {loadingDeleteRepo ? "Deleting repository…" : "Delete repository permanently"}
              </button>
            </div>
          </div>

          {deleteResult ? (
            <div className="rounded-3xl border border-green-200 bg-emerald-50 p-5 text-sm text-slate-900">
              <p className="font-semibold text-emerald-900">File cleanup completed</p>
              <p className="mt-2">Deleted files: {deleteResult.deleted_count}</p>
              {deleteResult.deleted_files.length > 0 && (
                <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
                  <ul className="space-y-2">
                    {deleteResult.deleted_files.map((file) => (
                      <li key={file} className="truncate text-slate-700">
                        {file}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}

          {deleteRepoResult ? (
            <div className="rounded-3xl border border-green-200 bg-emerald-50 p-5 text-sm text-slate-900">
              <p className="font-semibold text-emerald-900">Repository deleted</p>
              <p className="mt-2">{deleteRepoResult.message}</p>
              <p className="mt-1 text-slate-600">
                Removed: <code>{deleteRepoResult.deleted_repo}</code>
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
