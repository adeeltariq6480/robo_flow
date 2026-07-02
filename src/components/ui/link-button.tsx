"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500",
  secondary:
    "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
  ghost: "text-slate-600 hover:bg-slate-100 focus:ring-slate-400",
};

interface LinkButtonProps {
  href: string;
  variant?: Variant;
  className?: string;
  title?: string;
  children: ReactNode;
}

export function LinkButton({
  href,
  variant = "primary",
  className = "",
  title,
  children,
}: LinkButtonProps) {
  const [loading, setLoading] = useState(false);

  return (
    <Link
      href={href}
      title={title}
      aria-busy={loading}
      onClick={() => setLoading(true)}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </Link>
  );
}
