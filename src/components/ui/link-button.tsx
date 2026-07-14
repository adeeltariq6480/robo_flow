"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { Skeleton } from "@/components/ui/skeleton";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-md shadow-emerald-500/20 hover:-translate-y-0.5 hover:shadow-lg focus:ring-emerald-500",
  secondary:
    "bg-white/90 text-slate-700 border border-slate-200 shadow-sm hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50/60 focus:ring-emerald-400",
  danger: "bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-md hover:-translate-y-0.5 focus:ring-red-500",
  ghost: "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800 focus:ring-emerald-400",
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
  const { startNavigation, isPending } = useNavigationPending();
  const loading = isPending(href);

  return (
    <Link
      href={href}
      title={title}
      aria-busy={loading}
      onClick={() => startNavigation(href)}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${variants[variant]} ${loading ? "opacity-80" : ""} ${className}`}
    >
      {loading && <Skeleton className="h-4 w-4 shrink-0 rounded-full" />}
      {children}
    </Link>
  );
}
