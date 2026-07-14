/**
 * ShopData-style CSV helpers for Stock check image downloads.
 * Columns: "Pre Image", "Result Image" (URL values).
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
    // skip trailing empty line
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

export function findStockColumnIndex(
  headers: string[],
  column: StockCsvColumn
): number {
  const aliases = COLUMN_ALIASES[column];
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx >= 0) return idx;
  }
  // fuzzy: header includes alias
  for (let i = 0; i < normalized.length; i++) {
    for (const alias of aliases) {
      if (normalized[i].includes(alias)) return i;
    }
  }
  return -1;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractImageUrls(
  csvText: string,
  column: StockCsvColumn
): { urls: string[]; columnLabel: string; totalRows: number } {
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
    // normalize double-slash path typos: images//pre_images → images/pre_images
    let url = raw.replace(/([^:]\/)\/+/g, "$1");
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return {
    urls,
    columnLabel: headers[idx] || column,
    totalRows: rows.length,
  };
}

export function fileNameFromUrl(url: string, index: number): string {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").filter(Boolean).pop() || `image_${index + 1}.jpg`;
    const safe = base.replace(/[^\w.\-()+]+/g, "_");
    return safe || `image_${index + 1}.jpg`;
  } catch {
    return `image_${index + 1}.jpg`;
  }
}
