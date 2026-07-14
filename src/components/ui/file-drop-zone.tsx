"use client";

import { useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { CircularProgress } from "@/components/ui/circular-progress";

interface FileDropZoneProps {
  onFiles: (files: File[]) => void | Promise<void>;
  children?: ReactNode;
  disabled?: boolean;
  multiple?: boolean;
  accept?: string;
  className?: string;
  hint?: string;
  subhint?: string;
  uploading?: boolean;
  progress?: number;
  progressLabel?: string;
  progressSublabel?: string;
  prepareLabel?: string;
  prepareSublabel?: string;
}

export function FileDropZone({
  onFiles,
  children,
  disabled = false,
  multiple = true,
  accept,
  className = "",
  hint = "Click or drag & drop files here",
  subhint,
  uploading = false,
  progress = 0,
  progressLabel,
  progressSublabel,
  prepareLabel = "Preparing files…",
  prepareSublabel,
}: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const depthRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = disabled || uploading || preparing;

  async function pickFiles(fileList: FileList | null) {
    if (!fileList?.length || busy) return;
    const files = multiple ? Array.from(fileList) : Array.from(fileList).slice(0, 1);

    setPreparing(true);
    try {
      await Promise.resolve(onFiles(files));
    } finally {
      setPreparing(false);
    }
  }

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    depthRef.current += 1;
    setDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    depthRef.current -= 1;
    if (depthRef.current <= 0) {
      depthRef.current = 0;
      setDragging(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) e.dataTransfer.dropEffect = "copy";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    depthRef.current = 0;
    setDragging(false);
    if (busy) return;
    void pickFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border-2 border-dashed shadow-sm transition-all duration-300 ${
        dragging
          ? "border-brand-500 bg-brand-50/80"
          : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/50"
      } ${busy ? "pointer-events-none opacity-90" : ""} ${className}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children ?? (
        <label className="flex cursor-pointer flex-col items-center justify-center bg-gradient-to-br from-white via-emerald-50/30 to-cyan-50/40 px-6 py-12 transition hover:from-emerald-50/60 hover:to-cyan-50/70">
          <Upload
            className={`h-10 w-10 ${dragging ? "text-brand-600" : "text-slate-400"}`}
          />
          <span className="mt-3 text-sm font-medium text-slate-700">{hint}</span>
          {subhint && (
            <span className="mt-1 text-xs text-slate-500">{subhint}</span>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple={multiple}
            accept={accept}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              void pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {dragging && !uploading && !preparing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-brand-500/10">
          <p className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm">
            Drop to add files
          </p>
        </div>
      )}

      {preparing && !uploading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/95 backdrop-blur-[2px]">
          <CircularProgress
            value={0}
            indeterminate
            label={prepareLabel}
            sublabel={
              prepareSublabel ?? "Reading selected files, please wait…"
            }
          />
        </div>
      )}

      {uploading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/90 backdrop-blur-[1px]">
          <CircularProgress
            value={progress}
            label={progressLabel ?? "Uploading…"}
            sublabel={progressSublabel ?? `${progress}% complete`}
          />
        </div>
      )}
    </div>
  );
}
