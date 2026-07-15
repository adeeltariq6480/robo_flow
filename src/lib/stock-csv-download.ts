/**
 * ShopData-style CSV helpers for Stock check image downloads + similar pairs.
 * Columns: "Pre Image", "Result Image", "Similar Image", "Similar Score%"
 */

export type StockCsvColumn = "pre" | "result";

const COLUMN_ALIASES: Record<StockCsvColumn, string[]> = {
  pre: ["pre image", "pre_image", "preimage", "pre"],
  result: [
    "result image",
    "result_image",
    "resultimage",
    "result",
    "labelled image",
    "labeled image",
  ],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** Minimal CSV parser that respects quotes / commas inside quotes. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === "" && rows.length > 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      pushField();
      continue;
    }
    if (ch === "\n") {
      pushField();
      pushRow();
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1) };
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx >= 0) return idx;
  }
  for (let i = 0; i < normalized.length; i++) {
    for (const alias of aliases) {
      if (normalized[i].includes(alias)) return i;
    }
  }
  return -1;
}

export function findStockColumnIndex(
  headers: string[],
  column: StockCsvColumn
): number {
  return findHeaderIndex(headers, COLUMN_ALIASES[column]);
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeImageUrl(raw: string): string {
  return raw.trim().replace(/([^:]\/)\/+/g, "$1");
}

export function parsePercent(value: string): number {
  const m = String(value ?? "")
    .trim()
    .replace(/,/g, ".")
    .match(/-?\d+(\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : 0;
}

export function extractImageUrls(
  csvText: string,
  column: StockCsvColumn,
  limit = 0
): {
  urls: string[];
  columnLabel: string;
  totalRows: number;
  totalAvailable: number;
} {
  const { headers, rows } = parseCsv(csvText);
  const idx = findStockColumnIndex(headers, column);
  if (idx < 0) {
    throw new Error(
      column === "pre"
        ? 'CSV mein "Pre Image" column nahi mila.'
        : 'CSV mein "Result Image" column nahi mila.'
    );
  }
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const row of rows) {
    const raw = (row[idx] ?? "").trim();
    if (!raw || !isHttpUrl(raw)) continue;
    const url = normalizeImageUrl(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  const totalAvailable = urls.length;
  const capped = limit > 0 ? urls.slice(0, limit) : urls;
  return {
    urls: capped,
    columnLabel: headers[idx] || column,
    totalRows: rows.length,
    totalAvailable,
  };
}

export type SimilarPairRow = {
  imageId: string;
  outletName: string;
  csvScore: number;
  csvSimilarFlag: string;
  resultUrl: string;
  similarUrl: string;
};

export type BarcodeIssueRow = {
  imageId: string;
  outletName: string;
  status: "mismatch" | "fake";
  statusLabel: string;
  barcode: string;
  aiBarcode: string;
  imageUrl: string;
};

export function extractBarcodeIssues(
  csvText: string,
  limit = 0
): { issues: BarcodeIssueRow[]; totalMatching: number } {
  const { headers, rows } = parseCsv(csvText);
  const statusIdx = findHeaderIndex(headers, ["barcode status"]);
  const imageIdx = findHeaderIndex(headers, ["barcode image"]);
  const barcodeIdx = findHeaderIndex(headers, ["barcode"]);
  const aiBarcodeIdx = findHeaderIndex(headers, ["ai barcode number"]);
  const imageIdIdx = findHeaderIndex(headers, ["image id", "image_id"]);
  const outletIdx = findHeaderIndex(headers, ["outlet name", "outlet_name"]);
  if (statusIdx < 0 || imageIdx < 0) {
    throw new Error('CSV mein "Barcode Status" aur "Barcode Image" columns chahiye.');
  }

  const cleanBarcode = (value: string) => value.trim().replace(/^"+|"+$/g, "");
  const issues: BarcodeIssueRow[] = [];
  for (const row of rows) {
    const label = (row[statusIdx] ?? "").trim();
    const normalized = label.toLowerCase();
    const status = normalized.includes("mismatch")
      ? "mismatch"
      : normalized.includes("fake")
        ? "fake"
        : null;
    if (!status) continue;
    const rawUrl = (row[imageIdx] ?? "").trim();
    if (!rawUrl || !isHttpUrl(rawUrl)) continue;
    issues.push({
      imageId: imageIdIdx >= 0 ? (row[imageIdIdx] ?? "").trim() : String(issues.length + 1),
      outletName: outletIdx >= 0 ? (row[outletIdx] ?? "").trim() : "",
      status,
      statusLabel: label,
      barcode: barcodeIdx >= 0 ? cleanBarcode(row[barcodeIdx] ?? "") : "",
      aiBarcode: aiBarcodeIdx >= 0 ? cleanBarcode(row[aiBarcodeIdx] ?? "") : "",
      imageUrl: normalizeImageUrl(rawUrl),
    });
  }
  return {
    issues: limit > 0 ? issues.slice(0, limit) : issues,
    totalMatching: issues.length,
  };
}

/**
 * Rows with Result Image + Similar Image where Similar Score% >= minScore
 * (default 80 — pairs claimed similar at/above 80%).
 */
export function extractSimilarPairs(
  csvText: string,
  minScore = 80,
  limit = 0
): { pairs: SimilarPairRow[]; totalMatching: number } {
  const { headers, rows } = parseCsv(csvText);
  const resultIdx = findStockColumnIndex(headers, "result");
  const similarIdx = findHeaderIndex(headers, [
    "similar image",
    "similar_image",
    "similarimage",
  ]);
  const scoreIdx = findHeaderIndex(headers, [
    "similar score%",
    "similar score",
    "similarscore%",
    "similar score %",
  ]);
  const similarFlagIdx = findHeaderIndex(headers, ["similar"]);
  const imageIdIdx = findHeaderIndex(headers, ["image id", "image_id"]);
  const outletIdx = findHeaderIndex(headers, ["outlet name", "outlet_name"]);

  if (resultIdx < 0 || similarIdx < 0) {
    throw new Error(
      'CSV mein "Result Image" aur "Similar Image" columns chahiye.'
    );
  }

  const pairs: SimilarPairRow[] = [];
  for (const row of rows) {
    const resultRaw = (row[resultIdx] ?? "").trim();
    const similarRaw = (row[similarIdx] ?? "").trim();
    if (!resultRaw || !similarRaw) continue;
    if (!isHttpUrl(resultRaw) || !isHttpUrl(similarRaw)) continue;

    const csvScore = scoreIdx >= 0 ? parsePercent(row[scoreIdx] ?? "0") : 0;
    if (csvScore < minScore) continue;

    const resultUrl = normalizeImageUrl(resultRaw);
    const similarUrl = normalizeImageUrl(similarRaw);
    if (resultUrl === similarUrl) continue;

    pairs.push({
      imageId:
        imageIdIdx >= 0
          ? (row[imageIdIdx] ?? "").trim() || String(pairs.length + 1)
          : String(pairs.length + 1),
      outletName: outletIdx >= 0 ? (row[outletIdx] ?? "").trim() : "",
      csvScore,
      csvSimilarFlag:
        similarFlagIdx >= 0 ? (row[similarFlagIdx] ?? "").trim() : "",
      resultUrl,
      similarUrl,
    });
  }

  const totalMatching = pairs.length;
  return {
    pairs: limit > 0 ? pairs.slice(0, limit) : pairs,
    totalMatching,
  };
}

export function fileNameFromUrl(url: string, index: number): string {
  try {
    const path = new URL(url).pathname;
    const base =
      path.split("/").filter(Boolean).pop() || `image_${index + 1}.jpg`;
    const safe = base.replace(/[^\w.\-()+]+/g, "_");
    return safe || `image_${index + 1}.jpg`;
  } catch {
    return `image_${index + 1}.jpg`;
  }
}
