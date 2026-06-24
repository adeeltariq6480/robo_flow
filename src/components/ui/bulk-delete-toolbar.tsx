"use client";

import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface BulkDeleteToolbarProps {
  itemLabel: string;
  totalCount: number;
  selectedCount: number;
  onDeleteSelected: () => void;
  onDeleteAll: () => void;
  disabled?: boolean;
  showSelectAll?: boolean;
  allSelected?: boolean;
  onToggleSelectAll?: () => void;
}

export function BulkDeleteToolbar({
  itemLabel,
  totalCount,
  selectedCount,
  onDeleteSelected,
  onDeleteAll,
  disabled = false,
  showSelectAll = true,
  allSelected = false,
  onToggleSelectAll,
}: BulkDeleteToolbarProps) {
  if (totalCount === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        {showSelectAll && onToggleSelectAll && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleSelectAll}
              disabled={disabled}
              className="rounded border-slate-300"
            />
            Select all
          </label>
        )}
        <span>
          {selectedCount > 0
            ? `${selectedCount} selected`
            : `${totalCount} ${itemLabel}`}
        </span>
      </div>
      <div className="flex gap-2">
        {selectedCount > 0 && (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={onDeleteSelected}
              disabled={disabled}
              className="!border-red-200 !text-red-700 hover:!bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onDeleteAll}
              disabled={disabled}
              className="!border-red-300 !text-red-800 hover:!bg-red-100"
            >
              <Trash2 className="h-4 w-4" />
              Delete all
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
