"use client";

import type { Model } from "@/lib/types/database";

interface ModelMultiSelectProps {
  models: Model[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  maxSelected?: number;
}

export function ModelMultiSelect({
  models,
  selectedIds,
  onChange,
  disabled = false,
  maxSelected = 10,
}: ModelMultiSelectProps) {
  const allSelected =
    models.length > 0 && selectedIds.length === models.length;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
      return;
    }
    if (selectedIds.length >= maxSelected) return;
    onChange([...selectedIds, id]);
  }

  function toggleAll() {
    if (allSelected) onChange([]);
    else onChange(models.slice(0, maxSelected).map((m) => m.id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-700">
          Models for labeling ({selectedIds.length} selected)
        </label>
        <button
          type="button"
          onClick={toggleAll}
          disabled={disabled || models.length === 0}
          className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {models.map((m) => {
          const selected = selectedIds.includes(m.id);
          const atLimit = !selected && selectedIds.length >= maxSelected;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(m.id)}
              disabled={disabled || atLimit}
              title={atLimit ? `Maximum ${maxSelected} models` : undefined}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600/30"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              <span className="font-medium">{m.name}</span>
              <span className="ml-1 text-slate-400">v{m.version}</span>
            </button>
          );
        })}
      </div>

      {selectedIds.length === 1 && models.length > 1 && (
        <p className="rounded-md border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-brand-800">
          Tip: aur models bhi select kar sakte ho — har image par sab models chalenge aur
          overlapping boxes merge ho jayengi.
        </p>
      )}

      <p className="text-xs text-slate-500">
        Har image par sab selected models chalenge; overlapping boxes merge ho jayenge
        (highest confidence rakhi jati hai). Max {maxSelected} models.
      </p>
    </div>
  );
}
