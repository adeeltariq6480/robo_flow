"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

type ConfirmState = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
} | null;

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>(null);
  const [resolver, setResolver] = useState<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (opts: {
      title?: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
    }) =>
      new Promise<boolean>((resolve) => {
        setResolver(() => resolve);
        setState({
          title: opts.title ?? "Please confirm",
          message: opts.message,
          confirmText: opts.confirmText ?? "Delete",
          cancelText: opts.cancelText ?? "Cancel",
        });
      }),
    []
  );

  function close(ok: boolean) {
    resolver?.(ok);
    setResolver(null);
    setState(null);
  }

  const dialog = state ? (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">{state.title}</h3>
        <p className="mt-2 text-sm text-slate-600">{state.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => close(false)}>
            {state.cancelText}
          </Button>
          <Button
            onClick={() => close(true)}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {state.confirmText}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
