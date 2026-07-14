"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { fetchStockColabSession, openStockColabCheck } from "@/lib/actions/inference";
import { extractImageUrls } from "@/lib/stock-csv-download";
import type { DirectStockResult } from "@/lib/worker/client";
import { Copy, ExternalLink, Play, X } from "lucide-react";

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
        <div className="mt-5 space-y-5">
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h4 className="font-semibold text-emerald-950">Product summary</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(totals).map(([name, count]) => <span key={name} className="rounded-full bg-white px-3 py-1 text-sm">{name}: <strong>{count}</strong></span>)}
              {!Object.keys(totals).length && <span className="text-sm">No products detected yet.</span>}
            </div>
            <p className="mt-3 text-sm text-amber-900">
              Needs model work: {Object.entries(reviewTotals).length
                ? Object.entries(reviewTotals).sort((a,b) => b[1]-a[1]).map(([n,c]) => `${n} (${c} low-confidence)`).join(", ")
                : "No low-confidence product detections found."}
            </p>
          </section>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row, index) => (
            <article key={`${row.url}-${index}`} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium">Result Image {index + 1}</div>
              <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-slate-100 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={proxySrc(row.url)} alt={`Result ${index + 1}`} className="max-h-[70vh] w-full object-contain" loading="lazy" />
                </div>
                <div className="min-w-0">
                  {row.error ? <Alert variant="error">{row.error}</Alert> : <>
                    <h5 className="text-sm font-semibold">Counts</h5>
                    <div className="mt-2 space-y-1 text-sm">
                      {Object.entries(row.counts).map(([name, count]) => <p key={name}>{name}: <strong>{count}</strong></p>)}
                      {!Object.keys(row.counts).length && <p>No product detected</p>}
                    </div>
                    <p className={`mt-4 text-sm ${row.possible_wrong ? "text-amber-800" : "text-emerald-700"}`}>
                      {row.possible_wrong ? `${row.possible_wrong} possible wrong/low-confidence detection(s): ${Object.entries(row.needs_review).map(([n,c]) => `${n} ${c}`).join(", ")}` : "No suspicious low-confidence detection"}
                    </p>
                  </>}
                </div>
              </div>
            </article>
          ))}
          </div>
        </div>
        </ResultsPortal>
      )}
    </div>
  );
}
