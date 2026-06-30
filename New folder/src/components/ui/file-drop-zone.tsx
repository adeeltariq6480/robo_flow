"use client";

import { useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";

interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  children?: ReactNode;
  disabled?: boolean;
  multiple?: boolean;
  accept?: string;
  className?: string;
  hint?: string;
  subhint?: string;
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
}: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const depthRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFiles(fileList: FileList | null) {
    if (!fileList?.length || disabled) return;
    const files = Array.from(fileList);
    onFiles(multiple ? files : files.slice(0, 1));
  }

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    depthRef.current += 1;
    setDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    depthRef.current -= 1;
    if (depthRef.current <= 0) {
      depthRef.current = 0;
      setDragging(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) e.dataTransfer.dropEffect = "copy";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    depthRef.current = 0;
    setDragging(false);
    if (disabled) return;
    pickFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed transition-colors ${
        dragging
          ? "border-brand-500 bg-brand-50/80"
          : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/50"
      } ${disabled ? "pointer-events-none opacity-60" : ""} ${className}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children ?? (
        <label className="flex cursor-pointer flex-col items-center justify-center px-6 py-12">
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
            disabled={disabled}
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-brand-500/10">
          <p className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm">
            Drop to add files
          </p>
        </div>
      )}
    </div>
  );
}
