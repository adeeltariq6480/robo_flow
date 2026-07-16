import { API_BASE_URL } from "@/lib/api/client";

export interface TemporaryLabelResult { file_name: string; image_url: string; width?: number; height?: number; detections: Array<{ class_name: string; confidence: number; x: number; y: number; width: number; height: number; source?: string; matcher_score?: number }> ; error?: string }
export interface TemporaryLabelSession { id: string; status: "uploading" | "waiting_for_colab" | "running" | "completed" | "failed"; processed: number; total: number; message: string; results: TemporaryLabelResult[]; error?: string | null }

async function response<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) { try { throw new Error(JSON.parse(text).detail || text); } catch (error) { if (error instanceof SyntaxError) throw new Error(text || `Request failed (${res.status})`); throw error; } }
  return JSON.parse(text) as T;
}

export async function startTemporaryLabelSession(args: { projectId: string; modelIds: string[]; confidence: number; iou: number; threshold: number; references: Array<{ className: string; files: File[] }>; targets: File[] }) {
  const form = new FormData(); form.set("project_id", args.projectId); form.set("model_ids", JSON.stringify(args.modelIds)); form.set("confidence", String(args.confidence)); form.set("iou", String(args.iou)); form.set("threshold", String(args.threshold));
  const manifest: Array<{ class_name: string; paths: string[] }> = [];
  args.references.forEach((reference, productIndex) => {
    const paths: string[] = [];
    reference.files.forEach((file, index) => { const path = `references/${productIndex}/${index}_${file.name.replaceAll("__", "_")}`; paths.push(path); form.append("files", file, path.replaceAll("/", "__")); });
    manifest.push({ class_name: reference.className, paths });
  });
  args.targets.forEach((file, index) => form.append("files", file, `targets__${index}_${file.name.replaceAll("__", "_")}`));
  form.set("reference_manifest", JSON.stringify(manifest));
  return response<{ session_id: string; token: string; colab_url: string; config_url: string }>(await fetch(`${API_BASE_URL}/api/label-tool-colab/start`, { method: "POST", body: form }));
}

export async function getTemporaryLabelSession(token: string) { return response<TemporaryLabelSession>(await fetch(`${API_BASE_URL}/api/label-tool-colab/session/${encodeURIComponent(token)}`, { cache: "no-store" })); }
export async function deleteTemporaryLabelSession(token: string) { return response<{ ok: boolean }>(await fetch(`${API_BASE_URL}/api/label-tool-colab/session/${encodeURIComponent(token)}`, { method: "DELETE" })); }

export async function startTemporaryTraining(args: { projectId: string; datasetZip: Blob; epochs: number; imageSize: number }) {
  const form = new FormData(); form.set("project_id", args.projectId); form.set("epochs", String(args.epochs)); form.set("image_size", String(args.imageSize)); form.set("dataset_zip", args.datasetZip, "label-tool-training.zip");
  return response<{ token: string; colab_url: string; config_url: string }>(await fetch(`${API_BASE_URL}/api/label-tool-train/start`, { method: "POST", body: form }));
}

export async function startApprovedDatasetTraining(args: { projectId: string; datasetId: string; epochs?: number; imageSize?: number }) {
  return response<{ token: string; colab_url: string; config_url: string }>(await fetch(`${API_BASE_URL}/api/review-train/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: args.projectId, dataset_id: args.datasetId, epochs: args.epochs ?? 50, image_size: args.imageSize ?? 640 }) }));
}
