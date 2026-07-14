"use client";

const KEY = "axiomai:csvDownloadStatus";
const TTL_MS = 60 * 60_000; // 1 hour for large ZIP jobs

export function setCsvDownloadStatus(
  active: boolean,
  label = "Downloading images…"
) {
  try {
    if (active) {
      localStorage.setItem(
        KEY,
        JSON.stringify({ active: true, label, ts: Date.now() })
      );
    } else {
      localStorage.removeItem(KEY);
    }
    window.dispatchEvent(new Event("axiomai-csv-download-status"));
  } catch {
    /* ignore */
  }
}

export function getCsvDownloadStatus(): { active: boolean; label: string } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      active: boolean;
      label?: string;
      ts?: number;
    };
    if (!parsed.active) return null;
    if (parsed.ts && Date.now() - parsed.ts > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { active: true, label: parsed.label ?? "Downloading images…" };
  } catch {
    return null;
  }
}

/** Refresh TTL timestamp while job is still running (so long jobs keep banner). */
export function touchCsvDownloadStatus(label?: string) {
  const cur = getCsvDownloadStatus();
  if (!cur?.active) return;
  setCsvDownloadStatus(true, label ?? cur.label);
}
