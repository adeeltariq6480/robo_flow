"use client";

import type { Model } from "@/lib/types/database";

interface ModelMultiSelectProps {
  models: Model[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function ModelMultiSelect({
  models,
  selectedIds,
  onChange,
  disabled = false,
}: ModelMultiSelectProps) {
  const allSelected = models.length > 0 && selectedIds.length === models.length;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function toggleAll() {
    if (allSelected) onChange([]);
    else onChange(models.map((m) => m.id));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">
          Models ({selectedIds.length} selected)
        </label>
        <button
          type="button"
          onClick={toggleAll}
          disabled={disabled || models.length === 0}
          className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>
      <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {models.map((m) => (
          <li key={m.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selectedIds.includes(m.id)}
                onChange={() => toggle(m.id)}
                disabled={disabled}
                className="rounded border-slate-300"
              />
              <span className="text-sm text-slate-800">
                {m.name}{" "}
                <span className="text-slate-400">v{m.version}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Har image par sab selected models chalenge; overlapping boxes merge ho
        jayenge (highest confidence rakhi jati hai).
      </p>
    </div>
  );
}
