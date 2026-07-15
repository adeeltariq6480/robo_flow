"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { extractBarcodeIssues, type BarcodeIssueRow } from "@/lib/stock-csv-download";
import { AlertTriangle, Copy, ScanBarcode, ShieldAlert, X } from "lucide-react";

function proxySrc(url: string) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

export function StockBarcodeIssuesPanel({ csvFile, limit, disabled }: { csvFile: File | null; limit: number; disabled?: boolean }) {
  const [issues, setIssues] = useState<BarcodeIssueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function showIssues() {
    if (!csvFile) return;
    setError(null);
    try {
      const result = extractBarcodeIssues(await csvFile.text(), limit);
      setIssues(result.issues);
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
    setIssues([]); setTotal(0); setError(null); setCopied(null);
  }

  const mismatch = issues.filter((item) => item.status === "mismatch").length;
  const fake = issues.filter((item) => item.status === "fake").length;

  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void showIssues()} disabled={!csvFile || disabled}>
          <ScanBarcode className="h-4 w-4" /> Show mismatch & fake barcodes
        </Button>
        {(issues.length > 0 || error) && <Button type="button" variant="secondary" onClick={clear}><X className="h-4 w-4" />Clear</Button>}
        <span className="text-xs text-slate-500">Uses Barcode Status + Barcode Image · shared limit {limit}</span>
      </div>
      {error && <div className="mt-3"><Alert variant="info">{error}</Alert></div>}
      {issues.length > 0 && <div className="mt-5 space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-900">Mismatch: {mismatch}</span>
          <span className="rounded-full bg-rose-100 px-3 py-1 font-semibold text-rose-900">Fake: {fake}</span>
          {total > issues.length && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Showing {issues.length} of {total}</span>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-5">
          {issues.map((issue, index) => <article key={`${issue.imageId}-${index}`} className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${issue.status === "fake" ? "border-rose-200" : "border-amber-200"}`}>
            <div className={`flex items-center justify-between px-3 py-2 text-xs font-semibold ${issue.status === "fake" ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>
              <span className="flex items-center gap-1.5">{issue.status === "fake" ? <ShieldAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{issue.statusLabel}</span>
              <span>#{issue.imageId || index + 1}</span>
            </div>
            <div className="p-3">
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
        </div>
      </div>}
    </div>
  );
}
