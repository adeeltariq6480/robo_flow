import JSZip from "jszip";
import {
  extractImageUrls,
  fileNameFromUrl,
  type StockCsvColumn,
} from "@/lib/stock-csv-download";

export type CsvDownloadProgress = {
  done: number;
  total: number;
  failed: number;
  label: string;
};

function proxyUrl(imageUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}

async function fetchImageBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(proxyUrl(url));
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(
      (err && typeof err.error === "string" && err.error) ||
        `Failed ${res.status}`
    );
  }
  return res.arrayBuffer();
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : ".jpg";
  let n = 2;
  while (used.has(`${stem}_${n}${ext}`)) n++;
  const next = `${stem}_${n}${ext}`;
  used.add(next);
  return next;
}

/**
 * Parse ShopData CSV, download only the chosen column images, ZIP to browser.
 * Does not upload or save anything to the project.
 */
export async function downloadStockCsvImages(
  csvFile: File,
  column: StockCsvColumn,
  onProgress?: (p: CsvDownloadProgress) => void
): Promise<{ downloaded: number; failed: number; zipName: string }> {
  const text = await csvFile.text();
  const { urls, columnLabel } = extractImageUrls(text, column);
  if (urls.length === 0) {
    throw new Error(`No image URLs found in "${columnLabel}".`);
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  let done = 0;
  let failed = 0;
  const concurrency = 6;

  onProgress?.({
    done: 0,
    total: urls.length,
    failed: 0,
    label: `Downloading ${urls.length} ${columnLabel} image(s)…`,
  });

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url, batchIdx) => {
        const index = i + batchIdx;
        const name = uniqueName(fileNameFromUrl(url, index), usedNames);
        try {
          const bytes = await fetchImageBytes(url);
          zip.file(name, bytes);
          return true;
        } catch {
          return false;
        }
      })
    );
    for (const ok of results) {
      if (!ok) failed += 1;
      done += 1;
    }
    onProgress?.({
      done,
      total: urls.length,
      failed,
      label: `Downloading ${done} / ${urls.length}…`,
    });
  }

  const ok = urls.length - failed;
  if (ok === 0) {
    throw new Error("Could not download any images (network / blocked URLs).");
  }

  onProgress?.({
    done: urls.length,
    total: urls.length,
    failed,
    label: "Building ZIP…",
  });

  const blob = await zip.generateAsync({ type: "blob" });
  const zipName = `stock_${column}_images_${new Date()
    .toISOString()
    .slice(0, 10)}.zip`;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);

  return { downloaded: ok, failed, zipName };
}
