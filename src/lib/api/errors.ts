/** Duck-typed guards — avoids `instanceof` failures across Next.js server bundles. */

export function isNextRedirect(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("digest" in err)) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export function isBackendUnavailableError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "BackendUnavailableError") ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "BackendUnavailableError")
  );
}

export function getApiErrorStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export function isApiError(err: unknown): boolean {
  return getApiErrorStatus(err) !== null;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred while loading data.";
}
