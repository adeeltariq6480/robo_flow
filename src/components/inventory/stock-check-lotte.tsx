"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { fetchStockColabSession, openStockColabCheck } from "@/lib/actions/inference";
import type { DirectStockResult } from "@/lib/worker/client";
import { clearStockWorkbook, loadStockWorkbook, saveStockWorkbook } from "@/lib/stock-lotte-store";
import { Check, Copy, Download, ExternalLink, FileSpreadsheet, Package, RefreshCw, Search, Upload, X } from "lucide-react";

type ReviewStatus = "pending" | "ok" | "reject";
type Review = { status: ReviewStatus; note: string; excluded: boolean; checking: boolean; rechecked: boolean };
type SheetRow = { index: number; values: unknown[]; url: string };

const normalize = (value: unknown) => String(value ?? "").trim();
const normalizeHeader = (value: unknown) => normalize(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const isUrl = (value: string) => /^https?:\/\//i.test(value);
const proxySrc = (url: string) => `/api/image-proxy?url=${encodeURIComponent(url)}`;
const totalCount = (result?: DirectStockResult) => Object.values(result?.counts ?? {}).reduce((sum, count) => sum + count, 0);

function findDefaultImageColumn(headers: unknown[]) {
  const normalized = headers.map(normalizeHeader);
  for (const name of ["post image", "result image", "pre image", "image url", "image"]) {
    const index = normalized.indexOf(name);
    if (index >= 0) return index;
  }
  return headers.findIndex((header) => normalizeHeader(header).includes("image"));
}

export function StockCheckLotte({ projectId, modelIds }: { projectId: string; modelIds: string[] }) {
  const stateKey = `robo-flow:stock-lotte:${projectId}`;
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [matrix, setMatrix] = useState<unknown[][]>([]);
  const [imageColumn, setImageColumn] = useState(-1);
  const [results, setResults] = useState<Record<string, DirectStockResult>>({});
  const [reviews, setReviews] = useState<Record<number, Review>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [configUrl, setConfigUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const runRef = useRef(0);
  const restoredRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const storedFile = await loadStockWorkbook();
        const raw = localStorage.getItem(stateKey);
        const saved = raw ? JSON.parse(raw) as {
          sheetName?: string; imageColumn?: number; results?: Record<string, DirectStockResult>;
          reviews?: Record<number, Review>; configUrl?: string;
          session?: { token: string; urls: string[]; singleRow?: number } | null;
        } : null;
        if (!active) return;
        if (storedFile) await loadFile(storedFile, false, saved?.sheetName, saved?.imageColumn);
        if (!active || !saved) return;
        setResults(saved.results ?? {});
        setReviews(saved.reviews ?? {});
        setConfigUrl(saved.configUrl ?? "");
        if (saved.session?.token) {
          const runId = ++runRef.current;
          setRunning(true);
          setProgress("Previous check session restore ho rahi hai…");
          void waitForSession(saved.session.token, saved.session.urls, saved.session.singleRow, runId)
            .catch((cause) => setError(cause instanceof Error ? cause.message : "Session restore failed"))
            .finally(() => setRunning(false));
        }
      } catch {
        localStorage.removeItem(stateKey);
      } finally {
        restoredRef.current = true;
      }
    })();
    return () => { active = false; runRef.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  useEffect(() => {
    if (!restoredRef.current || !file) return;
    const previous = (() => { try { return JSON.parse(localStorage.getItem(stateKey) || "{}"); } catch { return {}; } })();
    localStorage.setItem(stateKey, JSON.stringify({ ...previous, sheetName, imageColumn, results, reviews, configUrl }));
  }, [stateKey, file, sheetName, imageColumn, results, reviews, configUrl]);

  const headers = matrix[0] ?? [];
  const rows = useMemo<SheetRow[]>(() => matrix.slice(1).map((values, offset) => ({
    index: offset + 1,
    values,
    url: imageColumn >= 0 ? normalize(values[imageColumn]) : "",
  })).filter((row) => isUrl(row.url)), [matrix, imageColumn]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      const detection = results[row.url];
      return [row.url, ...row.values.map(normalize), ...Object.keys(detection?.counts ?? {})]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [rows, results, search]);

  async function loadFile(selected: File, persist = true, preferredSheet?: string, preferredColumn?: number) {
    setError(null);
    setProgress("Excel file read ho rahi hai…");
    try {
      const book = XLSX.read(await selected.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheet = preferredSheet && book.SheetNames.includes(preferredSheet) ? preferredSheet : book.SheetNames[0];
      if (!firstSheet) throw new Error("Workbook mein koi sheet nahi mili.");
      const data = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[firstSheet], { header: 1, defval: "", raw: false });
      if (!data.length) throw new Error("Selected sheet khaali hai.");
      setFile(selected);
      setWorkbook(book);
      setSheetName(firstSheet);
      setMatrix(data);
      setImageColumn(preferredColumn !== undefined ? preferredColumn : findDefaultImageColumn(data[0]));
      setResults({});
      setReviews({});
      setConfigUrl("");
      if (persist) {
        await saveStockWorkbook(selected);
        localStorage.removeItem(stateKey);
      }
      setProgress(`${data.length - 1} rows read ho gayi hain.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Excel file read nahi ho saki.");
      setProgress("");
    }
  }

  function switchSheet(name: string) {
    if (!workbook) return;
    const data = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false });
    setSheetName(name);
    setMatrix(data);
    setImageColumn(findDefaultImageColumn(data[0] ?? []));
    setResults({});
    setReviews({});
    setConfigUrl("");
  }

  async function waitForSession(token: string, urls: string[], singleRow?: number, runId = runRef.current) {
    for (;;) {
      if (runId !== runRef.current) return;
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
      if (runId !== runRef.current) return;
      const session = await fetchStockColabSession(token);
      if ("actionError" in session) throw new Error(session.actionError);
      setProgress(`Checking images… ${session.processed}/${session.total}`);
      setResults((current) => {
        const next = { ...current };
        for (const result of session.results) next[result.url] = result;
        return next;
      });
      if (session.status === "completed") break;
      if (session.status === "failed") throw new Error(session.error || "Stock check failed.");
    }
    if (singleRow !== undefined) updateReview(singleRow, { checking: false, rechecked: true });
    const saved = (() => { try { return JSON.parse(localStorage.getItem(stateKey) || "{}"); } catch { return {}; } })();
    localStorage.setItem(stateKey, JSON.stringify({ ...saved, session: null }));
    setProgress(singleRow === undefined ? `${urls.length} images check ho gayi hain.` : "Selected image dobara check ho gayi.");
  }

  async function startCheck(urls: string[], singleRow?: number) {
    if (!urls.length || running || !modelIds.length) return;
    setRunning(true);
    const runId = ++runRef.current;
    setError(null);
    if (singleRow !== undefined) updateReview(singleRow, { checking: true });
    const popup = window.open("about:blank", "_blank");
    try {
      setProgress(singleRow === undefined ? "Stock check session ban rahi hai…" : "Sirf selected image ka recheck ban raha hai…");
      const launch = await openStockColabCheck(projectId, modelIds, urls);
      if ("error" in launch) throw new Error(launch.error);
      setConfigUrl(launch.config_url);
      const saved = (() => { try { return JSON.parse(localStorage.getItem(stateKey) || "{}"); } catch { return {}; } })();
      localStorage.setItem(stateKey, JSON.stringify({ ...saved, configUrl: launch.config_url, session: { token: launch.token, urls, singleRow } }));
      if (popup) popup.location.href = launch.colab_url;
      else window.open(launch.colab_url, "_blank", "noopener,noreferrer");
      try { await navigator.clipboard.writeText(launch.config_url); } catch { /* URL remains in session */ }
      setProgress("Colab khul gaya—config URL paste karke cell Run karein. Progress yahan update hogi.");
      await waitForSession(launch.token, urls, singleRow, runId);
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : "Stock check start nahi ho saka.");
      if (singleRow !== undefined) updateReview(singleRow, { checking: false });
    } finally {
      setRunning(false);
    }
  }

  function stopCheck() {
    runRef.current += 1;
    setRunning(false);
    setProgress("Check monitoring stop kar di gayi. Results abhi bhi saved hain.");
    const saved = (() => { try { return JSON.parse(localStorage.getItem(stateKey) || "{}"); } catch { return {}; } })();
    localStorage.setItem(stateKey, JSON.stringify({ ...saved, session: null }));
  }

  async function clearAll() {
    runRef.current += 1;
    await clearStockWorkbook();
    localStorage.removeItem(stateKey);
    setFile(null); setWorkbook(null); setSheetName(""); setMatrix([]); setImageColumn(-1);
    setResults({}); setReviews({}); setRunning(false); setProgress(""); setConfigUrl(""); setError(null); setSearch("");
  }

  function updateReview(index: number, patch: Partial<Review>) {
    setReviews((current) => {
      const previous: Review = current[index] ?? {
        status: "pending",
        note: "",
        excluded: false,
        checking: false,
        rechecked: false,
      };
      return { ...current, [index]: { ...previous, ...patch } };
    });
  }

  function downloadWorkbook() {
    if (!workbook || !file) return;
    const output = XLSX.read(XLSX.write(workbook, { type: "array", bookType: "xlsx" }), { type: "array" });
    const extraHeaders = ["Detected Products", "Detected Total", "Review Status", "Reviewer Note", "Include In Export", "Rechecked"];
    const exportRows = matrix.slice(1).flatMap((values, offset) => {
        const index = offset + 1;
        const review = reviews[index] ?? { status: "pending", note: "", excluded: false, checking: false, rechecked: false };
        if (review.status !== "ok" || review.excluded) return [];
        const url = imageColumn >= 0 ? normalize(values[imageColumn]) : "";
        const result = results[url];
        const summary = Object.entries(result?.counts ?? {}).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}: ${count}`).join(", ");
        return [[...values, summary, totalCount(result), "OK", review.note, "Yes", review.rechecked ? "Yes" : "No"]];
      });
    output.Sheets[sheetName] = XLSX.utils.aoa_to_sheet([
      [...headers, ...extraHeaders],
      ...exportRows,
    ]);
    XLSX.writeFile(output, file.name.replace(/\.xlsx?$/i, "") + "_stock-checked.xlsx");
  }

  const checked = rows.filter((row) => results[row.url]).length;
  const ok = Object.values(reviews).filter((review) => review.status === "ok").length;
  const rejected = Object.values(reviews).filter((review) => review.status === "reject").length;

  return (
    <div className="w-full min-w-0 space-y-6 pb-10">
      <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Excel review workflow</p><h1 className="mt-1 text-2xl font-bold text-slate-950">Stock Check Lotte</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Excel upload karein, model se har image ke product counts check karein, phir OK/Reject aur note ke saath complete workbook download karein.</p></div>
          <Button type="button" onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" /> Upload Excel</Button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void loadFile(selected); event.currentTarget.value = ""; }} />
        </div>
      </section>

      {error && <Alert variant="error">{error}</Alert>}
      {!modelIds.length && <Alert variant="info">Is project mein model nahi hai. Pehle Models page par model upload karein.</Alert>}

      {file && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="mr-auto flex items-center gap-3"><span className="rounded-xl bg-emerald-100 p-2 text-emerald-700"><FileSpreadsheet className="h-5 w-5" /></span><div><p className="font-semibold text-slate-900">{file.name}</p><p className="text-xs text-slate-500">{rows.length} valid image rows</p></div></div>
            {workbook && workbook.SheetNames.length > 1 && <label className="text-xs font-semibold text-slate-600">Sheet<select value={sheetName} onChange={(event) => switchSheet(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">{workbook.SheetNames.map((name) => <option key={name}>{name}</option>)}</select></label>}
            <label className="text-xs font-semibold text-slate-600">Image column<select value={imageColumn} onChange={(event) => { setImageColumn(Number(event.target.value)); setResults({}); setReviews({}); }} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">{headers.map((header, index) => <option value={index} key={`${normalize(header)}-${index}`}>{normalize(header) || `Column ${index + 1}`}</option>)}</select></label>
            <Button type="button" disabled={!rows.length || running || !modelIds.length} loading={running} onClick={() => void startCheck([...new Set(rows.map((row) => row.url))])}>{!running && <Package className="h-4 w-4" />} Check All Images</Button>
            {running && <Button type="button" variant="danger" onClick={stopCheck}><X className="h-4 w-4" /> Stop Check</Button>}
            <Button type="button" variant="secondary" disabled={!ok} onClick={downloadWorkbook}><Download className="h-4 w-4" /> Download OK Only ({ok})</Button>
            <Button type="button" variant="ghost" onClick={() => void clearAll()}><X className="h-4 w-4" /> Clear All</Button>
          </div>
          {progress && <p className="mt-3 text-sm text-emerald-800">{progress}</p>}
          {configUrl && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm font-semibold text-blue-950">Colab Config URL</p>
              <p className="mt-1 text-xs text-blue-800">Neeche wali poori URL copy karke Colab ke config URL box/cell mein paste karein, phir cell Run karein.</p>
              <code className="mt-2 block max-h-24 overflow-auto break-all rounded-lg border border-blue-200 bg-white p-2.5 text-xs text-blue-900">{configUrl}</code>
              <Button type="button" variant="secondary" className="mt-2" onClick={() => void navigator.clipboard.writeText(configUrl)}><Copy className="h-4 w-4" /> Copy Config URL</Button>
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3 text-sm">Checked <strong className="float-right">{checked}/{rows.length}</strong></div><div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">OK <strong className="float-right">{ok}</strong></div><div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Rejected <strong className="float-right">{rejected}</strong></div></div>
        </section>
      )}

      {!!rows.length && <label className="relative block max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Outlet, image ya product search karein…" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />{search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}</label>}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {visibleRows.map((row) => {
          const result = results[row.url];
          const review = reviews[row.index] ?? { status: "pending", note: "", excluded: false, checking: false, rechecked: false };
          return <article key={row.index} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${review.status === "ok" ? "border-emerald-300" : review.status === "reject" ? "border-red-300" : "border-slate-200"}`}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><span className="text-sm font-bold text-slate-800">Row {row.index + 1}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{result ? `${totalCount(result)} products` : "Not checked"}</span></div>
            <div className="p-3"><div className="flex min-h-48 items-center justify-center overflow-hidden rounded-xl bg-slate-100"><img src={proxySrc(row.url)} alt={`Stock row ${row.index + 1}`} loading="lazy" className="max-h-[55vh] w-full object-contain" /></div>
              <div className="mt-3 flex flex-wrap gap-1.5">{Object.entries(result?.counts ?? {}).sort((a,b) => b[1]-a[1]).map(([name,count]) => <span key={name} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">{name} <strong className="text-emerald-700">{count}</strong></span>)}{result && !Object.keys(result.counts).length && <span className="text-xs text-slate-500">No product detected</span>}</div>
              {result?.possible_wrong ? <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">{result.possible_wrong} low-confidence detection—review zaroor karein.</p> : null}
              <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => updateReview(row.index, { status: "ok" })} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold ${review.status === "ok" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}><Check className="h-4 w-4" /> OK</button><button type="button" onClick={() => updateReview(row.index, { status: "reject" })} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold ${review.status === "reject" ? "border-red-600 bg-red-600 text-white" : "border-red-200 text-red-700 hover:bg-red-50"}`}><X className="h-4 w-4" /> Reject</button></div>
              <button type="button" disabled={running || review.checking} onClick={() => void startCheck([row.url], row.index)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${review.checking ? "animate-spin" : ""}`} /> Check Again (only this image)</button>
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700"><input type="checkbox" checked={review.excluded} onChange={(event) => updateReview(row.index, { excluded: event.target.checked })} className="mt-0.5 h-4 w-4 accent-slate-700" /><span>Detection aur image mein farq hai—OK hone ke bawajood downloaded Excel mein include na karein.</span></label>
              <textarea value={review.note} onChange={(event) => updateReview(row.index, { note: event.target.value })} rows={3} placeholder="Is image ke against apna note likhein…" className="mt-3 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
              <a href={row.url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 truncate text-xs text-blue-600 hover:underline"><ExternalLink className="h-3.5 w-3.5 shrink-0" />{row.url}</a>
            </div>
          </article>;
        })}
      </div>
    </div>
  );
}
