import type { Model, ModelFormat } from "@/lib/types/database";

const FORMATS: ModelFormat[] = [
  "onnx",
  "pytorch",
  "tensorflow",
  "tflite",
  "other",
];

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toFormat(value: unknown): ModelFormat {
  if (typeof value === "string" && FORMATS.includes(value as ModelFormat)) {
    return value as ModelFormat;
  }
  return "other";
}

/** Normalize Supabase rows before passing to client components (avoids BigInt / null crashes). */
export function toClientModel(row: Model | Record<string, unknown>): Model {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    project_id: String(r.project_id ?? ""),
    name: String(r.name ?? "Model"),
    description:
      typeof r.description === "string"
        ? r.description
        : r.description == null
          ? null
          : String(r.description),
    file_path: String(r.file_path ?? ""),
    file_size: toNumber(r.file_size),
    format: toFormat(r.format),
    version:
      typeof r.version === "string" && r.version.trim()
        ? r.version
        : "1.0.0",
    created_by:
      r.created_by == null || r.created_by === ""
        ? ""
        : String(r.created_by),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

export function toClientModels(
  rows: (Model | Record<string, unknown>)[] | null | undefined
): Model[] {
  return (rows ?? []).map(toClientModel);
}
