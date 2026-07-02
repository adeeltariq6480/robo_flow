"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Variant = "primary" | "secondary" | "danger" | "ghost";

interface SubmitButtonProps {
  variant?: Variant;
  className?: string;
  children: ReactNode;
  /** Shown while the form action is running (optional). */
  pendingLabel?: ReactNode;
  disabled?: boolean;
}

/** Submit button with spinner — must be rendered inside a <form action={...}>. */
export function SubmitButton({
  variant = "primary",
  className = "",
  children,
  pendingLabel,
  disabled,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      loading={pending}
      disabled={disabled || pending}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
