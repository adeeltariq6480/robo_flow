export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
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
