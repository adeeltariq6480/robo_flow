export function formatBytes(bytes: unknown): string {
  const n =
    typeof bytes === "bigint"
      ? Number(bytes)
      : typeof bytes === "number"
        ? bytes
        : Number(bytes ?? 0);

  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.max(0, Math.floor(Math.log(n) / Math.log(k))),
    sizes.length - 1
  );
  return `${parseFloat((n / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const CLASS_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

export const MODEL_FORMATS = [
  { value: "onnx", label: "ONNX" },
  { value: "pytorch", label: "PyTorch (.pt)" },
  { value: "tensorflow", label: "TensorFlow" },
  { value: "tflite", label: "TFLite" },
  { value: "other", label: "Other" },
] as const;
