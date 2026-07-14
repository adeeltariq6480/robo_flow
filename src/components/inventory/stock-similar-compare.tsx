"use client";

import { useRef, useState } from "react";
import type { SimilarPairRow } from "@/lib/stock-csv-download";
import { extractSimilarPairs } from "@/lib/stock-csv-download";
import { compareImageUrls } from "@/lib/image-similarity";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CheckCircle2, Copy, GitCompare, X, XCircle } from "lucide-react";

export type SimilarCheckItem = SimilarPairRow & {
  visualScore?: number;
  isSimilar?: boolean;
  compareError?: string;
  status: "pending" | "ok" | "error";
};

function proxySrc(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

interface Props {
  csvFile: File | null;
  limit: number;
  disabled?: boolean;
}

export function StockSimilarComparePanel({ csvFile, limit, disabled }: Props) {
  const [minScore, setMinScore] = useState(80);
  const [items, setItems] = useState<SimilarCheckItem[]>([]);
  const [totalMatching, setTotalMatching] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const runTokenRef = useRef(0);

  async function handleCheck() {
    if (!csvFile || running) return;
    const runToken = ++runTokenRef.current;
    setRunning(true);
    setError(null);
    setItems([]);
    setProgress("Reading CSV…");
    try {
      const text = await csvFile.text();
      const { pairs, totalMatching: total } = extractSimilarPairs(
        text,
        minScore,
        limit
      );
      setTotalMatching(total);
      if (pairs.length === 0) {
        setError(
          `Koi pair nahi mila jiska Similar Score% ≥ ${minScore} aur Result + Similar Image dono hon.`
        );
        setProgress("");
        return;
      }

      const initial: SimilarCheckItem[] = pairs.map((p) => ({
        ...p,
        status: "pending",
      }));
      setItems(initial);
      setProgress(`Comparing 0 / ${pairs.length}…`);

      const concurrency = 3;
      const next = [...initial];
      for (let i = 0; i < pairs.length; i += concurrency) {
        if (runToken !== runTokenRef.current) return;
        const batch = pairs.slice(i, i + concurrency);
        await Promise.all(
          batch.map(async (pair, batchIdx) => {
            const idx = i + batchIdx;
            try {
              const result = await compareImageUrls(
                pair.resultUrl,
                pair.similarUrl,
                75
              );
              next[idx] = {
                ...pair,
                visualScore: result.visualScore,
                isSimilar: result.isSimilar,
                status: "ok",
              };
            } catch (e) {
              next[idx] = {
                ...pair,
                status: "error",
                compareError:
                  e instanceof Error ? e.message : "Compare failed",
              };
            }
          })
        );
        if (runToken !== runTokenRef.current) return;
        setItems([...next]);
        setProgress(`Comparing ${Math.min(i + concurrency, pairs.length)} / ${pairs.length}…`);
      }

      const similarCount = next.filter((x) => x.isSimilar).length;
      const notCount = next.filter((x) => x.status === "ok" && !x.isSimilar).length;
      setProgress(
        `Done — visual check: ${similarCount} similar, ${notCount} not similar` +
          (total > pairs.length
            ? ` (showing ${pairs.length} of ${total} matches ≥${minScore}%)`
            : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Similarity check failed");
      setProgress("");
    } finally {
      if (runToken === runTokenRef.current) setRunning(false);
    }
  }

  function handleClear() {
    runTokenRef.current += 1;
    setRunning(false);
    setItems([]);
    setTotalMatching(0);
    setProgress("");
    setError(null);
    setCopiedItem(null);
  }

  async function handleCopyUrls(item: SimilarCheckItem) {
    const key = `${item.imageId}-${item.resultUrl}`;
    try {
      await navigator.clipboard.writeText(
        `Result Image: ${item.resultUrl}\nSimilar Image: ${item.similarUrl}`
      );
      setCopiedItem(key);
      window.setTimeout(() => setCopiedItem((current) => (current === key ? null : current)), 2000);
    } catch {
      setError("Image URLs copy nahi ho sake. Browser clipboard permission check karein.");
    }
  }

  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            Similar Image check
          </h4>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            CSV se <strong>Result Image</strong> vs <strong>Similar Image</strong>{" "}
            jinka score ≥ threshold (default 80%). Side-by-side dikhao aur visual
            check batao: similar hai ya nahi.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Min Similar Score%</span>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={minScore}
            disabled={running || disabled}
            onChange={(e) => setMinScore(Number(e.target.value))}
          >
            {[50, 70, 80, 90, 95].map((n) => (
              <option key={n} value={n}>
                ≥ {n}%
              </option>
            ))}
          </select>
        </label>
        <p className="pb-2 text-xs text-slate-500">Shared limit: first {limit} pairs</p>
        <Button
          type="button"
          loading={running}
          disabled={!csvFile || running || disabled}
          onClick={() => void handleCheck()}
        >
          {!running && <GitCompare className="h-4 w-4" />}
          Check similar pairs
        </Button>
        {(running || items.length > 0 || progress || error) && (
          <Button type="button" variant="secondary" onClick={handleClear}>
            <X className="h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      {progress && (
        <p className="mt-3 text-xs text-slate-600">
          {progress}
          {totalMatching > 0 && !running
            ? ` · ${totalMatching} row(s) match filter`
            : ""}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-5 space-y-4">
          {items.map((item) => {
            const itemKey = `${item.imageId}-${item.resultUrl}`;
            return (
            <article
              key={itemKey}
              className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-slate-900">
                    #{item.imageId}
                  </span>
                  {item.outletName && (
                    <span className="ml-2 text-slate-500">{item.outletName}</span>
                  )}
                  <span className="ml-2 text-xs text-slate-400">
                    CSV: {item.csvScore}% · flag: {item.csvSimilarFlag || "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleCopyUrls(item)}
                    title="Copy Result Image and Similar Image URLs"
                    aria-label="Copy both image URLs"
                  >
                    <Copy className="h-4 w-4" />
                    {copiedItem === itemKey ? "Copied" : "Copy URLs"}
                  </Button>
                  <VerdictBadge item={item} />
                </div>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <figure className="min-w-0">
                  <figcaption className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Result Image
                  </figcaption>
                  <div className="flex items-center justify-center rounded-lg bg-slate-100 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proxySrc(item.resultUrl)}
                      alt="Result"
                      className="max-h-[70vh] w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                </figure>
                <figure className="min-w-0">
                  <figcaption className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Similar Image
                  </figcaption>
                  <div className="flex items-center justify-center rounded-lg bg-slate-100 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proxySrc(item.similarUrl)}
                      alt="Similar"
                      className="max-h-[70vh] w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                </figure>
              </div>
            </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ item }: { item: SimilarCheckItem }) {
  if (item.status === "pending") {
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
        Checking…
      </span>
    );
  }
  if (item.status === "error") {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
        Compare failed
      </span>
    );
  }
  if (item.isSimilar) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Similar ({item.visualScore}%)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
      <XCircle className="h-3.5 w-3.5" />
      Not similar ({item.visualScore}%)
    </span>
  );
}
