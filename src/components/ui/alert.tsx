"use client";

import { type ReactNode } from "react";
import { AlertCircle, CheckCircle, Info } from "lucide-react";

type AlertVariant = "error" | "success" | "info";

const styles: Record<AlertVariant, string> = {
  error: "border-rose-200 bg-gradient-to-r from-rose-50 to-red-50 text-rose-900 shadow-sm",
  success: "border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-900 shadow-sm",
  info: "border-sky-200 bg-gradient-to-r from-sky-50 to-cyan-50 text-sky-900 shadow-sm",
};

const icons: Record<AlertVariant, ReactNode> = {
  error: <AlertCircle className="h-4 w-4 shrink-0" />,
  success: <CheckCircle className="h-4 w-4 shrink-0" />,
  info: <Info className="h-4 w-4 shrink-0" />,
};

export function Alert({
  variant = "info",
  children,
}: {
  variant?: AlertVariant;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles[variant]}`}
    >
      {icons[variant]}
      <span>{children}</span>
    </div>
  );
}
