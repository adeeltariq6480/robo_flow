"use client";

import { CheckCircle2, XCircle } from "lucide-react";

export function SimpleToast({
  open,
  message,
  type = "success",
}: {
  open: boolean;
  message: string;
  type?: "success" | "error";
}) {
  if (!open) return null;
  return (
    <div className="fixed right-4 top-4 z-[130]">
      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${
          type === "success"
            ? "border-green-200 bg-green-50 text-green-800"
            : "border-red-200 bg-red-50 text-red-800"
        }`}
      >
        {type === "success" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
        {message}
      </div>
    </div>
  );
}
