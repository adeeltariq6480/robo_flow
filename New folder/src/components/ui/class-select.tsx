"use client";

import type { Class } from "@/lib/types/database";
import { ALL_CLASS_ID, ALL_CLASS_LABEL } from "@/lib/classes/constants";

interface ClassSelectProps {
  classes: Class[];
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
  allLabel?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  label?: string;
}

export function ClassSelect({
  classes,
  value,
  onChange,
  includeAll = true,
  allLabel = ALL_CLASS_LABEL,
  disabled = false,
  className = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm",
  id,
  label,
}: ClassSelectProps) {
  const selectValue = value === ALL_CLASS_ID || !value ? ALL_CLASS_ID : value;

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <select
        id={id}
        value={selectValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={className}
      >
        {includeAll && <option value={ALL_CLASS_ID}>{allLabel}</option>}
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
