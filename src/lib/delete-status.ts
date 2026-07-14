"use client";

const KEY = "axiomai:deleteStatus";
/** Keep banner visible long enough for large delete-all jobs while user navigates away. */
const TTL_MS = 10 * 60_000;

export function setDeleteStatus(active: boolean, label = "Deleting items...") {
  try {
    if (active) {
      localStorage.setItem(KEY, JSON.stringify({ active: true, label, ts: Date.now() }));
    } else {
      localStorage.removeItem(KEY);
    }
    window.dispatchEvent(new Event("axiomai-delete-status"));
  } catch {
    /* ignore */
  }
}

export function getDeleteStatus(): { active: boolean; label: string } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { active: boolean; label?: string; ts?: number };
    if (!parsed.active) return null;
    if (parsed.ts && Date.now() - parsed.ts > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { active: true, label: parsed.label ?? "Deleting items..." };
  } catch {
    return null;
  }
}
