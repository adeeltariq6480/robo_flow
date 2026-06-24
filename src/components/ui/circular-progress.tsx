"use client";

interface CircularProgressProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  sublabel?: string;
  indeterminate?: boolean;
  className?: string;
}

export function CircularProgress({
  value,
  size = 88,
  strokeWidth = 6,
  label,
  sublabel,
  indeterminate = false,
  className = "",
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className={`flex flex-col items-center gap-2 ${className}`}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress"}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-slate-200"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={indeterminate ? circumference * 0.25 : offset}
            className={`text-brand-600 transition-[stroke-dashoffset] duration-300 ${
              indeterminate ? "animate-spin origin-center" : ""
            }`}
            style={indeterminate ? { transformOrigin: "center" } : undefined}
          />
        </svg>
        {!indeterminate && (
          <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-800">
            {Math.round(clamped)}%
          </span>
        )}
        {indeterminate && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" />
          </span>
        )}
      </div>
      {label && (
        <p className="text-sm font-medium text-slate-700">{label}</p>
      )}
      {sublabel && (
        <p className="max-w-xs text-center text-xs text-slate-500">{sublabel}</p>
      )}
    </div>
  );
}
