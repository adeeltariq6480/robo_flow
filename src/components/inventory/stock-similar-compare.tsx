"use client";

import { useRef, useState } from "react";
import type { SimilarPairRow } from "@/lib/stock-csv-download";
import { extractSimilarPairs } from "@/lib/stock-csv-download";
import { compareImageUrls } from "@/lib/image-similarity";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { addStockItemsToSheet } from "@/lib/actions/stock-sheet";
import { CheckCircle2, Copy, FileSpreadsheet, GitCompare, Search, X, XCircle } from "lucide-react";

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
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetLoading, setSheetLoading] = useState<string | null>(null);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
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
    setSearch("");
    setSelected(new Set());
    setSheetMessage(null);
  }

  function toggleSelected(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setSheetMessage(null);
  }

  async function addItemToSheet(item: SimilarCheckItem) {
    const key = `${item.imageId}-${item.resultUrl}`;
    if (sheetLoading) return;
    setSheetLoading(key); setSheetMessage(null); setError(null);
    const result = await addStockItemsToSheet({
      category: "similar",
      items: [{
        image_id: item.imageId, outlet_name: item.outletName,
        result_url: item.resultUrl, similar_url: item.similarUrl,
        csv_score: item.csvScore, visual_score: item.visualScore ?? "",
      }],
    });
    setSheetLoading(null);
    if (!result.ok) { setError(result.error); return; }
    setSelected((current) => { const next = new Set(current); next.delete(key); return next; });
    setSheetMessage(`${result.added} image row(s) “${result.tab}” sheet mein add ho gayi.`);
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

  const query = search.trim().toLowerCase();
  const visibleItems = query ? items.filter((item) => [item.imageId, item.outletName, item.resultUrl, item.similarUrl]
    .some((value) => value.toLowerCase().includes(query))) : items;

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
          <label className="relative block max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Image ID, outlet or image URL…" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
            {search && <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Clear search"><X className="h-4 w-4" /></button>}
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-violet-100 px-3 py-1 font-semibold text-violet-900">
              Total similar pairs: {totalMatching}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
              Showing: {visibleItems.length}
            </span>
          </div>
          {sheetMessage && <Alert variant="success">{sheetMessage}</Alert>}
          {visibleItems.map((item, index) => {
            const itemKey = `${item.imageId}-${item.resultUrl}`;
            return (
            <article
              key={itemKey}
              className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
                <div className="min-w-0 text-sm">
                  <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-violet-600 px-1.5 text-xs font-bold text-white">
                    {index + 1}
                  </span>
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
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={selected.has(itemKey)} onChange={() => toggleSelected(itemKey)} className="h-4 w-4 accent-violet-600" />
                    Select
                  </label>
                  {selected.has(itemKey) && <Button type="button" loading={sheetLoading === itemKey} disabled={sheetLoading !== null && sheetLoading !== itemKey} onClick={() => void addItemToSheet(item)}>
                    {sheetLoading !== itemKey && <FileSpreadsheet className="h-4 w-4" />}Add to Sheet
                  </Button>}
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
          {visibleItems.length === 0 && <Alert variant="info">Is search se koi similar image nahi mili.</Alert>}
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
