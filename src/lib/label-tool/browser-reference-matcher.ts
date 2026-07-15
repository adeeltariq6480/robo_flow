export type MatchReference = { className: string; files: File[] };
export type ReferenceMatch = {
  x: number;
  y: number;
  width: number;
  height: number;
  className: string;
  score: number;
  detectorLabel: string;
  detectorScore: number;
};

type DetectorResult = { label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } };
type CallablePipeline = ((input: string, options?: Record<string, unknown>) => Promise<unknown>);
let detectorPromise: Promise<CallablePipeline> | null = null;
let embedderPromise: Promise<CallablePipeline> | null = null;

async function pipelines(onProgress: (message: string) => void) {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const progress_callback = (event: { status?: string; file?: string; progress?: number }) => {
    if (event.status === "progress" && typeof event.progress === "number") onProgress(`Downloading AI model: ${Math.round(event.progress)}%`);
  };
  detectorPromise ??= pipeline("object-detection", "Xenova/detr-resnet-50", { device: "wasm", progress_callback }) as unknown as Promise<CallablePipeline>;
  embedderPromise ??= pipeline("image-feature-extraction", "Xenova/clip-vit-base-patch32", { device: "wasm", progress_callback }) as unknown as Promise<CallablePipeline>;
  return Promise.all([detectorPromise, embedderPromise]);
}

function normalize(values: Float32Array | number[]) {
  let magnitude = 0;
  for (const value of values) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  return Float32Array.from(values, (value) => value / magnitude);
}

function cosine(a: Float32Array, b: Float32Array) {
  let result = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) result += a[i] * b[i];
  return result;
}

async function embedding(embedder: CallablePipeline, blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const tensor = await embedder(url, { pool: true }) as { data: Float32Array | number[] };
    return normalize(tensor.data);
  } finally { URL.revokeObjectURL(url); }
}

async function cropBlob(source: CanvasImageSource, x: number, y: number, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
  canvas.getContext("2d")!.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create detection crop")), "image/jpeg", 0.92));
}

export async function matchProductsInImage(args: {
  image: File;
  references: MatchReference[];
  threshold: number;
  detectionThreshold?: number;
  onProgress: (message: string) => void;
}): Promise<ReferenceMatch[]> {
  const [detector, embedder] = await pipelines(args.onProgress);
  args.onProgress("Building reference product fingerprints…");
  const referenceVectors: { className: string; vectors: Float32Array[] }[] = [];
  for (const reference of args.references) {
    const vectors: Float32Array[] = [];
    for (const file of reference.files) vectors.push(await embedding(embedder, file));
    if (vectors.length) referenceVectors.push({ className: reference.className, vectors });
  }

  const imageUrl = URL.createObjectURL(args.image);
  let detections: DetectorResult[];
  try {
    args.onProgress("Finding products in image…");
    detections = await detector(imageUrl, { threshold: args.detectionThreshold ?? 0.35 }) as DetectorResult[];
  } finally { URL.revokeObjectURL(imageUrl); }
  const bitmap = await createImageBitmap(args.image);
  const results: ReferenceMatch[] = [];
  try {
    for (let i = 0; i < detections.length; i++) {
      const detection = detections[i];
      const x = Math.max(0, detection.box.xmin), y = Math.max(0, detection.box.ymin);
      const width = Math.min(bitmap.width - x, detection.box.xmax - x), height = Math.min(bitmap.height - y, detection.box.ymax - y);
      if (width < 8 || height < 8) continue;
      args.onProgress(`Matching product ${i + 1} of ${detections.length}…`);
      const vector = await embedding(embedder, await cropBlob(bitmap, x, y, width, height));
      let bestClass = "", bestScore = -1;
      for (const reference of referenceVectors) for (const candidate of reference.vectors) {
        const score = cosine(vector, candidate);
        if (score > bestScore) { bestScore = score; bestClass = reference.className; }
      }
      if (bestClass && bestScore >= args.threshold) results.push({ x: x / bitmap.width, y: y / bitmap.height, width: width / bitmap.width, height: height / bitmap.height, className: bestClass, score: bestScore, detectorLabel: detection.label, detectorScore: detection.score });
    }
  } finally { bitmap.close(); }
  return results;
}
