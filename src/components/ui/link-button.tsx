"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { Skeleton } from "@/components/ui/skeleton";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-md shadow-brand-500/20 hover:from-brand-700 hover:to-indigo-700 focus:ring-brand-500",
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
  const { startNavigation, isPending } = useNavigationPending();
  const loading = isPending(href);

  return (
    <Link
      href={href}
      title={title}
      aria-busy={loading}
      onClick={() => startNavigation(href)}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${variants[variant]} ${loading ? "opacity-80" : ""} ${className}`}
    >
      {loading && <Skeleton className="h-4 w-4 shrink-0 rounded-full" />}
      {children}
    </Link>
  );
}
