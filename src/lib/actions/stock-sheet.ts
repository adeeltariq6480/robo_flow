"use server";

import { appendStockSheetRows } from "@/lib/worker/client";

export async function addStockItemsToSheet(input: {
  category: "similar" | "fake";
  items: Record<string, unknown>[];
}): Promise<{ ok: true; added: number; tab: string } | { ok: false; error: string }> {
  if (!input.items.length) return { ok: false, error: "Select at least one image." };
  try {
    const result = await appendStockSheetRows(input);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sheet update failed." };
  }
}
