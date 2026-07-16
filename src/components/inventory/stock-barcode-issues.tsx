"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { extractBarcodeIssues, type BarcodeIssueRow } from "@/lib/stock-csv-download";
import { addStockItemsToSheet } from "@/lib/actions/stock-sheet";
import { AlertTriangle, Copy, FileSpreadsheet, Search, ScanBarcode, ShieldAlert, X } from "lucide-react";

function proxySrc(url: string) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

export function StockBarcodeIssuesPanel({ csvFile, disabled }: { csvFile: File | null; disabled?: boolean }) {
  const [issues, setIssues] = useState<BarcodeIssueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);

  async function showIssues() {
    if (!csvFile) return;
    setError(null);
    try {
      const result = extractBarcodeIssues(await csvFile.text());
      setIssues(result.issues);
      setSelected(new Set()); setSheetMessage(null);
      setTotal(result.totalMatching);
      if (!result.issues.length) setError("CSV mein mismatch ya fake Barcode Image nahi mili.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Barcode issues read nahi ho sake.");
    }
  }

  async function copyUrl(issue: BarcodeIssueRow) {
    await navigator.clipboard.writeText(issue.imageUrl);
    setCopied(issue.imageId);
    window.setTimeout(() => setCopied((current) => current === issue.imageId ? null : current), 1800);
  }

  function clear() {
    setIssues([]); setTotal(0); setError(null); setCopied(null); setSearch(""); setSelected(new Set()); setSheetMessage(null);
  }

  const issueKey = (issue: BarcodeIssueRow) => `${issue.imageId}-${issue.imageUrl}`;
  function toggleSelected(issue: BarcodeIssueRow) {
    const key = issueKey(issue);
    setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    setSheetMessage(null);
  }

  async function addSelectedToSheet() {
    const chosen = issues.filter((issue) => issue.status === "fake" && selected.has(issueKey(issue)));
    if (!chosen.length || sheetLoading) return;
    setSheetLoading(true); setError(null); setSheetMessage(null);
    const result = await addStockItemsToSheet({ category: "fake", items: chosen.map((issue) => ({
      image_id: issue.imageId, outlet_name: issue.outletName, image_url: issue.imageUrl,
      barcode: issue.barcode, ai_barcode: issue.aiBarcode, status: issue.statusLabel,
    })) });
    setSheetLoading(false);
    if (!result.ok) { setError(result.error); return; }
    setSelected(new Set()); setSheetMessage(`${result.added} image row(s) “${result.tab}” sheet mein add ho gayi.`);
  }

  const query = search.trim().toLowerCase();
  const visibleIssues = query ? issues.filter((item) => [item.imageId, item.barcode, item.aiBarcode, item.outletName, item.statusLabel]
    .some((value) => value.toLowerCase().includes(query))) : issues;
  const fakeIssues = visibleIssues.filter((item) => item.status === "fake");
  const mismatchIssues = visibleIssues.filter((item) => item.status === "mismatch");

  function issueGrid(items: BarcodeIssueRow[]) {
    return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-5">
      {items.map((issue, index) => <article key={`${issue.imageId}-${index}`} className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${issue.status === "fake" ? "border-rose-200" : "border-amber-200"}`}>
        <div className={`flex items-center justify-between px-3 py-2 text-xs font-semibold ${issue.status === "fake" ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>
          <span className="flex min-w-0 items-center gap-1.5">{issue.status === "fake" ? <ShieldAlert className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}<span className="truncate">{issue.statusLabel}</span></span>
          <span className="flex shrink-0 items-center gap-1.5"><strong className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-900 px-1.5 text-white">{index + 1}</strong><span>#{issue.imageId || "—"}</span></span>
        </div>
        <div className="p-3">
          {issue.status === "fake" && <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
            <input type="checkbox" checked={selected.has(issueKey(issue))} onChange={() => toggleSelected(issue)} className="h-4 w-4 accent-rose-600" />Select for Fake Barcode sheet
          </label>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proxySrc(issue.imageUrl)} alt={issue.statusLabel} className="max-h-[55vh] w-full rounded-xl bg-slate-100 object-contain" loading="lazy" />
          <div className="mt-3 space-y-1 text-xs text-slate-600">
            {issue.outletName && <p className="truncate font-semibold text-slate-800" title={issue.outletName}>{issue.outletName}</p>}
            <p>Barcode: <strong>{issue.barcode || "—"}</strong></p>
            <p>AI Barcode: <strong>{issue.aiBarcode || "—"}</strong></p>
          </div>
          <Button type="button" variant="secondary" className="mt-3 w-full" onClick={() => void copyUrl(issue)}>
            <Copy className="h-4 w-4" />{copied === issue.imageId ? "URL copied" : "Copy image URL"}
          </Button>
        </div>
      </article>)}
    </div>;
  }

  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void showIssues()} disabled={!csvFile || disabled}>
          <ScanBarcode className="h-4 w-4" /> Show mismatch & fake barcodes
        </Button>
        {(issues.length > 0 || error) && <Button type="button" variant="secondary" onClick={clear}><X className="h-4 w-4" />Clear</Button>}
        <span className="text-xs text-slate-500">Scans the complete CSV · no image limit</span>
      </div>
      {error && <div className="mt-3"><Alert variant="info">{error}</Alert></div>}
      {issues.length > 0 && <div className="mt-5 space-y-6">
        <label className="relative block max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Image ID, Barcode or AI Barcode…" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
          {search && <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </label>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-violet-100 px-3 py-1 font-semibold text-violet-900">Total issues: {total}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Showing: {visibleIssues.length}</span>
          <span className="rounded-full bg-rose-100 px-3 py-1 font-semibold text-rose-900">Fake: {fakeIssues.length}</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-900">Mismatch: {mismatchIssues.length}</span>
          {selected.size > 0 && <Button type="button" loading={sheetLoading} onClick={() => void addSelectedToSheet()}>
            {!sheetLoading && <FileSpreadsheet className="h-4 w-4" />}Add {selected.size} to Sheet
          </Button>}
        </div>
        {sheetMessage && <Alert variant="success">{sheetMessage}</Alert>}

        {fakeIssues.length > 0 && <section className="space-y-3">
          <div className="flex items-center gap-2 border-b border-rose-200 pb-2 text-rose-900">
            <ShieldAlert className="h-5 w-5" />
            <h3 className="text-base font-bold">Fake Barcodes</h3>
            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold">{fakeIssues.length}</span>
          </div>
          {issueGrid(fakeIssues)}
        </section>}

        {mismatchIssues.length > 0 && <section className="space-y-3 pt-2">
          <div className="flex items-center gap-2 border-b border-amber-200 pb-2 text-amber-900">
            <AlertTriangle className="h-5 w-5" />
            <h3 className="text-base font-bold">Mismatch Barcodes</h3>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold">{mismatchIssues.length}</span>
          </div>
          {issueGrid(mismatchIssues)}
        </section>}
        {visibleIssues.length === 0 && <Alert variant="info">Is search se koi barcode image nahi mili.</Alert>}
      </div>}
    </div>
  );
}
