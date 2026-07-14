/**
 * Lightweight perceptual compare (average hash) for Result vs Similar images.
 * Runs in the browser via image-proxy — no project save.
 */

function proxyUrl(imageUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  const res = await fetch(proxyUrl(url));
  if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image decode failed"));
      el.src = objectUrl;
    });
  } finally {
    // Keep object URL until paint is done — revoke on next tick after load
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

/** 8×8 average hash → 64-bit binary string */
function averageHash(img: HTMLImageElement): string {
  const size = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const grays: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    grays.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  const avg = grays.reduce((a, b) => a + b, 0) / grays.length;
  return grays.map((g) => (g >= avg ? "1" : "0")).join("");
}

function hamming(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}

export type ImageCompareResult = {
  /** 0–100 visual similarity from perceptual hash */
  visualScore: number;
  /** true when visualScore >= visualThreshold */
  isSimilar: boolean;
  hammingDistance: number;
};

/**
 * Compare two image URLs. Default: similar if visual score >= 75.
 */
export async function compareImageUrls(
  urlA: string,
  urlB: string,
  visualThreshold = 75
): Promise<ImageCompareResult> {
  const [imgA, imgB] = await Promise.all([
    loadImageElement(urlA),
    loadImageElement(urlB),
  ]);
  const hashA = averageHash(imgA);
  const hashB = averageHash(imgB);
  const distance = hamming(hashA, hashB);
  const visualScore = Math.round((1 - distance / 64) * 100);
  return {
    visualScore,
    isSimilar: visualScore >= visualThreshold,
    hammingDistance: distance,
  };
}
