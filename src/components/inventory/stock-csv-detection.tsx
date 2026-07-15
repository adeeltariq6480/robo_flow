"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { fetchStockColabSession, openStockColabCheck } from "@/lib/actions/inference";
import { extractImageUrls } from "@/lib/stock-csv-download";
import type { DirectStockResult } from "@/lib/worker/client";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Package, Play, Search, X } from "lucide-react";

interface Props {
  projectId: string;
  modelIds: string[];
  csvFile: File | null;
  limit: number;
  disabled?: boolean;
}

type Row = DirectStockResult & { error?: string };

function proxySrc(url: string) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

function ResultsPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.getElementById("stock-check-results-root"));
  }, []);
  return target ? createPortal(children, target) : children;
}

export function StockCsvDetectionPanel({ projectId, modelIds, csvFile, limit, disabled }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [configUrl, setConfigUrl] = useState("");
  const [colabUrl, setColabUrl] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const runRef = useRef(0);
  const watchingRef = useRef(false);
  const storageKey = `robo-flow:stock-colab:${projectId}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        token: string;
        configUrl: string;
        colabUrl: string;
        total: number;
      };
      if (!saved.token) return;
      setSessionToken(saved.token);
      setConfigUrl(saved.configUrl || "");
      setColabUrl(saved.colabUrl || "");
      setTotal(saved.total || 0);
      setProgress("Previous Colab session restored — checking progress…");
      const runToken = ++runRef.current;
      void watchSession(saved.token, runToken);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
    return () => {
      runRef.current += 1;
      watchingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const totals = useMemo(() => {
    const result: Record<string, number> = {};
    for (const row of rows) for (const [name, count] of Object.entries(row.counts || {})) {
      result[name] = (result[name] || 0) + count;
    }
    return result;
  }, [rows]);
  const reviewTotals = useMemo(() => {
    const result: Record<string, number> = {};
    for (const row of rows) for (const [name, count] of Object.entries(row.needs_review || {})) {
      result[name] = (result[name] || 0) + count;
    }
    return result;
  }, [rows]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => [row.url, ...Object.keys(row.counts || {}), ...Object.keys(row.needs_review || {})]
      .some((value) => value.toLowerCase().includes(query)));
  }, [rows, search]);

  async function handleCheck() {
    if (!csvFile || running || modelIds.length === 0) return;
    const token = ++runRef.current;
    setRunning(true);
    setRows([]);
    setError(null);
    setConfigUrl("");
    setColabUrl("");
    setSessionToken("");
    setProcessed(0);
    setTotal(0);
    setSearch("");
    try {
      const parsed = extractImageUrls(await csvFile.text(), "result", limit);
      if (!parsed.urls.length) throw new Error('CSV mein valid "Result Image" URL nahi mila.');
      setProgress("Creating temporary Colab session…");
      const launch = await openStockColabCheck(projectId, modelIds, parsed.urls);
      if ("error" in launch) throw new Error(launch.error);
      setConfigUrl(launch.config_url);
      setColabUrl(launch.colab_url);
      setSessionToken(launch.token);
      setTotal(launch.total);
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          token: launch.token,
          configUrl: launch.config_url,
          colabUrl: launch.colab_url,
          total: launch.total,
        })
      );
      try {
        await navigator.clipboard.writeText(launch.config_url);
      } catch {
        // The URL is also shown below if browser clipboard permission is blocked.
      }
      setProgress("Config ready — ab Open in Colab click karein. Config notebook mein pehle se added hai.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stock check failed");
      setProgress("");
    } finally {
      if (token === runRef.current) setRunning(false);
    }
  }

  async function handleOpenColab() {
    if (!sessionToken || !colabUrl || running) return;
    const token = runRef.current;
    try {
      await navigator.clipboard.writeText(configUrl);
    } catch {
      // Config remains visible for manual copy.
    }
    window.open(colabUrl, "_blank", "noopener,noreferrer");
    setRunning(true);
    setError(null);
    setProgress("Colab opened — config URL paste karke wohi cell Run karein; install aur check khud start hoga.");
    await watchSession(sessionToken, token);
  }

  async function watchSession(tokenValue: string, token: number) {
    if (watchingRef.current) return;
    watchingRef.current = true;
    try {
      while (token === runRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 4000));
        if (token !== runRef.current) return;
        const session = await fetchStockColabSession(tokenValue);
        if ("actionError" in session) throw new Error(session.actionError);
        setRows(session.results as Row[]);
        setRunning(session.status === "running");
        setProcessed(session.processed);
        setTotal(session.total);
        setProgress(`${session.message} · ${session.processed}/${session.total}`);
        if (session.status === "completed") {
          setProgress(`Done on Colab GPU — ${session.processed} Result Image(s). Nothing saved to DB.`);
          break;
        }
        if (session.status === "failed") throw new Error(session.error || "Colab check failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Colab progress failed");
    } finally {
      watchingRef.current = false;
      if (token === runRef.current) setRunning(false);
    }
  }

  function clear() {
    runRef.current += 1;
    setRunning(false);
    setRows([]);
    setProgress("");
    setError(null);
    setConfigUrl("");
    setColabUrl("");
    setSessionToken("");
    setProcessed(0);
    setTotal(0);
    watchingRef.current = false;
    window.localStorage.removeItem(storageKey);
  }

  return (
    <div className="mt-6 border-t border-slate-100 pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void handleCheck()} loading={running}
          disabled={!csvFile || !modelIds.length || running || disabled}>
          {!running && <Play className="h-4 w-4" />} Generate Config
        </Button>
        {sessionToken && colabUrl && !running && (
          <Button type="button" onClick={() => void handleOpenColab()}>
            <ExternalLink className="h-4 w-4" /> Open in Colab
          </Button>
        )}
        {(running || rows.length > 0 || progress || error) && (
          <Button type="button" variant="secondary" onClick={clear}><X className="h-4 w-4" />Clear</Button>
        )}
        <span className="text-xs text-slate-500">Direct temporary check · no image/job/result saved</span>
      </div>
      {progress && <p className="mt-3 text-sm text-slate-600">{progress}</p>}
      {total > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-600">
            <span>Colab progress: {processed} / {total}</span>
            <span>{Math.round((processed / total) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.round((processed / total) * 100))}%` }}
            />
          </div>
        </div>
      )}
      {configUrl && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="text-sm font-semibold text-blue-950">Stock Check Config URL</p>
          <code className="mt-2 block max-h-24 overflow-auto break-all rounded border border-blue-200 bg-white p-2 text-xs text-blue-900">
            {configUrl}
          </code>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void navigator.clipboard.writeText(configUrl)}>
              <Copy className="h-4 w-4" /> Copy config URL
            </Button>
            {colabUrl && (
              <Button type="button" variant="secondary" onClick={() => window.open(colabUrl, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="h-4 w-4" /> Open manual Colab
              </Button>
            )}
          </div>
        </div>
      )}
      {error && <div className="mt-3"><Alert variant="error">{error}</Alert></div>}

      {rows.length > 0 && (
        <ResultsPortal>
        <div className="space-y-6">
          <label className="relative block max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search image URL or detected product…" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
            {search && <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Clear search"><X className="h-4 w-4" /></button>}
          </label>
          <section className="overflow-hidden rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-emerald-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-emerald-600 p-2 text-white shadow-sm">
                  <Package className="h-5 w-5" />
                </span>
                <div>
                  <h4 className="font-semibold text-slate-950">Product summary</h4>
                  <p className="text-xs text-slate-500">{rows.length} images checked · {Object.values(totals).reduce((sum, count) => sum + count, 0)} products found</p>
                </div>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-100">
                Colab analysis
              </span>
            </div>
            <div className="p-5">
              <div className="flex flex-wrap gap-2">
                {Object.entries(totals).sort((a,b) => b[1]-a[1]).map(([name, count]) => (
                  <span key={name} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                    <span className="max-w-[180px] truncate">{name}</span>
                    <strong className="rounded-lg bg-emerald-600 px-2 py-0.5 text-xs text-white">{count}</strong>
                  </span>
                ))}
                {!Object.keys(totals).length && <span className="text-sm text-slate-500">No products detected yet.</span>}
              </div>
              <div className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${Object.keys(reviewTotals).length ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"}`}>
                {Object.keys(reviewTotals).length ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                <p><strong>Needs model work:</strong> {Object.entries(reviewTotals).length
                  ? Object.entries(reviewTotals).sort((a,b) => b[1]-a[1]).map(([n,c]) => `${n} (${c} low-confidence)`).join(", ")
                  : "No low-confidence product detections found."}</p>
              </div>
            </div>
          </section>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-5">
          {visibleRows.map((row, index) => (
            <article key={`${row.url}-${index}`} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Image {index + 1}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{Object.values(row.counts || {}).reduce((sum, count) => sum + count, 0)} found</span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-3">
                <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 p-1.5 ring-1 ring-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={proxySrc(row.url)} alt={`Result ${index + 1}`} className="max-h-[70vh] w-full rounded-lg object-contain transition duration-300 group-hover:scale-[1.01]" loading="lazy" />
                </div>
                <div className="min-w-0">
                  {row.error ? <div className="max-h-48 overflow-y-auto break-words rounded-xl text-xs"><Alert variant="error">{row.error}</Alert></div> : <>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(row.counts).sort((a,b) => b[1]-a[1]).map(([name, count]) => <span key={name} title={name} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700"><span className="truncate">{name}</span><strong className="text-emerald-700">{count}</strong></span>)}
                      {!Object.keys(row.counts).length && <p className="text-xs text-slate-500">No product detected</p>}
                    </div>
                    <div className={`mt-3 flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-xs ${row.possible_wrong ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
                      {row.possible_wrong ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                      <span>{row.possible_wrong ? `${row.possible_wrong} possible wrong: ${Object.entries(row.needs_review).map(([n,c]) => `${n} ${c}`).join(", ")}` : "Detection looks good"}</span>
                    </div>
                  </>}
                </div>
              </div>
            </article>
          ))}
          </div>
          {visibleRows.length === 0 && <Alert variant="info">Is search se koi stock image nahi mili.</Alert>}
        </div>
        </ResultsPortal>
      )}
    </div>
  );
}
