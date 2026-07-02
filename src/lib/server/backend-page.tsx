import { BackendSetupRequired } from "@/components/layout/backend-setup-required";
import {
  getApiErrorStatus,
  getErrorMessage,
  isApiError,
  isBackendUnavailableError,
  isNextRedirect,
} from "@/lib/api/errors";
import type { ReactNode } from "react";

const API_KEY_MESSAGE =
  "Backend rejected the API key (401). On Vercel set WORKER_API_KEY to the same " +
  "value as Railway, or remove WORKER_API_KEY on both Vercel and Railway for open no-auth mode.";

/** Renders a setup card for known backend errors, or null to rethrow. */
export function backendErrorPage(err: unknown): ReactNode | null {
  if (isNextRedirect(err)) {
    throw err;
  }

  if (isBackendUnavailableError(err)) {
    return (
      <BackendSetupRequired
        message={getErrorMessage(err)}
        showHomeActions={false}
      />
    );
  }

  const status = getApiErrorStatus(err);
  if (status !== null || isApiError(err)) {
    if (status === 401) {
      return <BackendSetupRequired message={API_KEY_MESSAGE} showHomeActions={false} />;
    }
    if (status === 403) {
      return (
        <BackendSetupRequired
          message={`Backend denied access (403): ${getErrorMessage(err)}`}
          showHomeActions={false}
        />
      );
    }
    if (status === 404) {
      return (
        <BackendSetupRequired
          message={`Backend resource not found (404): ${getErrorMessage(err)}`}
          showHomeActions={false}
        />
      );
    }
    if (status !== null && status >= 500) {
      return (
        <BackendSetupRequired
          message={`Backend error (${status}): ${getErrorMessage(err)}`}
          showHomeActions={false}
        />
      );
    }
    if (status !== null) {
      return (
        <BackendSetupRequired
          message={`Request failed (${status}): ${getErrorMessage(err)}`}
          showHomeActions={false}
        />
      );
    }
  }

  if (err instanceof TypeError) {
    return (
      <BackendSetupRequired
        message={`Unexpected API response: ${getErrorMessage(err)}`}
        showHomeActions={false}
      />
    );
  }

  if (err instanceof Error) {
    return (
      <BackendSetupRequired
        message={getErrorMessage(err)}
        showHomeActions={false}
      />
    );
  }

  return null;
}

/** Wrap server page loaders so API failures show a setup card instead of a 500. */
export async function runBackendPage(
  loader: () => Promise<ReactNode>
): Promise<ReactNode> {
  try {
    return await loader();
  } catch (err) {
    const page = backendErrorPage(err);
    if (page) return page;
    throw err;
  }
}
