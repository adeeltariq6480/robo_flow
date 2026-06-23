import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/types/database";
import { redirect, notFound } from "next/navigation";

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function getProject(projectId: string): Promise<Project> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error || !data) notFound();
  return data;
}

export async function requireProject(projectId: string): Promise<Project> {
  await requireUser();
  return getProject(projectId);
}

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
