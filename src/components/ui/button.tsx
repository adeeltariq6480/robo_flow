"use client";

import { useState, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-md shadow-emerald-500/20 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/25 focus:ring-emerald-500",
  secondary:
    "bg-white/90 text-slate-700 border border-slate-200 shadow-sm hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-800 focus:ring-emerald-400",
  danger: "bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-md shadow-red-500/15 hover:-translate-y-0.5 hover:shadow-lg focus:ring-red-500",
  ghost: "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800 focus:ring-emerald-400",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  className = "",
  loading = false,
  disabled,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const busy = loading || internalLoading;

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (!onClick) return;
    const result = onClick(event) as void | Promise<unknown>;
    if (result != null && typeof (result as Promise<unknown>).then === "function") {
      setInternalLoading(true);
      try {
        await result;
      } finally {
        setInternalLoading(false);
      }
    }
  }

  return (
    <button
      className={`relative inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50 ${variants[variant]} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={onClick ? handleClick : undefined}
      {...props}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
