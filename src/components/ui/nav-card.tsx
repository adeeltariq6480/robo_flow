"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { CardLoadingOverlay } from "@/components/ui/card-loading-overlay";
import { useNavigationPending } from "@/hooks/use-navigation-pending";

interface NavCardProps {
  href: string;
  children: ReactNode;
  className?: string;
}

export function NavCard({ href, children, className = "" }: NavCardProps) {
  const { startNavigation, isPending } = useNavigationPending();
  const loading = isPending(href);

  return (
    <Link
      href={href}
      className={`block ${className}`}
      onClick={() => startNavigation(href)}
      aria-busy={loading}
    >
      <Card
        className={`relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-xl hover:shadow-emerald-500/10 ${
          loading ? "pointer-events-none ring-2 ring-brand-400/40" : ""
        }`}
      >
        {loading && <CardLoadingOverlay />}
        {children}
      </Card>
    </Link>
  );
}
