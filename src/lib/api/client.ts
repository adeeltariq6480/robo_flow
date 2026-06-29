/**
 * Typed HTTP client for the Robo Flow FastAPI backend.
 *
 * The frontend talks ONLY to this backend — no Firebase Admin / Storage and no
 * secrets in the browser. The base URL is the public worker API URL.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_WORKER_API_URL ?? "http://localhost:8000";

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) {
      return data.detail.map((d: { msg?: string }) => d.msg).join(", ");
    }
    return JSON.stringify(data);
  } catch {
    return (await res.text()) || `Request failed (${res.status})`;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    ...options,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });

  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status);
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
};

/** Absolute URL for streaming image bytes from the backend (HF proxy). */
export function imageContentUrl(projectId: string, imageId: string): string {
  return `${API_BASE_URL}/api/images/${projectId}/${imageId}/content`;
}

export { ApiError };
