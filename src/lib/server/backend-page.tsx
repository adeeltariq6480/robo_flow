import { BackendSetupRequired } from "@/components/layout/backend-setup-required";
import { ApiError, BackendUnavailableError } from "@/lib/api/client";
import type { ReactNode } from "react";

const API_KEY_MESSAGE =
  "Backend rejected the API key (401). On Vercel set WORKER_API_KEY to the same " +
  "value as Railway, or remove WORKER_API_KEY on Railway for open no-auth mode.";

/** Renders a setup card for known backend errors, or null to rethrow. */
export function backendErrorPage(err: unknown): ReactNode | null {
  if (err instanceof BackendUnavailableError) {
    return <BackendSetupRequired message={err.message} showHomeActions={false} />;
  }
  if (err instanceof ApiError && err.status === 401) {
    return <BackendSetupRequired message={API_KEY_MESSAGE} showHomeActions={false} />;
  }
  return null;
}
