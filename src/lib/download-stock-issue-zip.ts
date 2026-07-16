import JSZip from "jszip";
import { extractBarcodeIssues, extractSimilarPairs, fileNameFromUrl } from "@/lib/stock-csv-download";

export type StockIssueCategory = "similar" | "fake" | "mismatch";

export async function downloadStockIssueZip(csvFile: File, categories: StockIssueCategory[], onProgress?: (label: string) => void) {
  const text = await csvFile.text();
  const entries: Array<{ category: StockIssueCategory; url: string; name: string }> = [];
  if (categories.includes("similar")) {
    const { pairs } = extractSimilarPairs(text, 0);
    pairs.forEach((pair, index) => {
      entries.push({ category: "similar", url: pair.resultUrl, name: `result_${fileNameFromUrl(pair.resultUrl, index)}` });
      entries.push({ category: "similar", url: pair.similarUrl, name: `similar_${fileNameFromUrl(pair.similarUrl, index)}` });
    });
  }
  if (categories.includes("fake") || categories.includes("mismatch")) {
    const { issues } = extractBarcodeIssues(text);
    issues.filter((issue) => categories.includes(issue.status)).forEach((issue, index) => entries.push({ category: issue.status, url: issue.imageUrl, name: fileNameFromUrl(issue.imageUrl, index) }));
  }
  if (!entries.length) throw new Error("Selected categories mein koi image nahi mili.");
  const zip = new JSZip(); const used = new Set<string>(); let done = 0;
  for (const entry of entries) {
    onProgress?.(`Downloading ${++done}/${entries.length}…`);
    const response = await fetch(`/api/image-proxy?url=${encodeURIComponent(entry.url)}`);
    if (!response.ok) continue;
    let name = entry.name, suffix = 2;
    while (used.has(`${entry.category}/${name}`)) name = `${suffix++}_${entry.name}`;
    used.add(`${entry.category}/${name}`); zip.folder(entry.category)!.file(name, await response.arrayBuffer());
  }
  onProgress?.("Building selected issues ZIP…");
  const blob = await zip.generateAsync({ type: "blob" }); const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `stock_selected_issues_${new Date().toISOString().slice(0, 10)}.zip`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
