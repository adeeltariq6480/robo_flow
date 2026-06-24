import type { AnnotationBox } from "@/lib/types/annotations";

export interface DisplayRect {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** Compute letterboxed image display area inside a container. */
export function computeDisplayRect(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number
): DisplayRect {
  if (imageW <= 0 || imageH <= 0) {
    return { offsetX: 0, offsetY: 0, width: containerW, height: containerH };
  }
  const scale = Math.min(containerW / imageW, containerH / imageH);
  const width = imageW * scale;
  const height = imageH * scale;
  return {
    offsetX: (containerW - width) / 2,
    offsetY: (containerH - height) / 2,
    width,
    height,
  };
}

export function normalizedToPixel(
  box: Pick<AnnotationBox, "x" | "y" | "width" | "height">,
  rect: DisplayRect
) {
  const cx = box.x * rect.width + rect.offsetX;
  const cy = box.y * rect.height + rect.offsetY;
  const w = box.width * rect.width;
  const h = box.height * rect.height;
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
    cx,
    cy,
  };
}

export function pixelToNormalized(
  x: number,
  y: number,
  width: number,
  height: number,
  rect: DisplayRect
): Pick<AnnotationBox, "x" | "y" | "width" | "height"> {
  const cx = x + width / 2;
  const cy = y + height / 2;
  return {
    x: clamp01((cx - rect.offsetX) / rect.width),
    y: clamp01((cy - rect.offsetY) / rect.height),
    width: clamp01(width / rect.width),
    height: clamp01(height / rect.height),
  };
}

export function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function newBoxId() {
  return crypto.randomUUID();
}

export function parseAnnotations(raw: unknown): AnnotationBox[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, i) => {
      const o = item as Record<string, unknown>;
      return {
        id: typeof o.id === "string" ? o.id : `box-${i}`,
        class_name: String(o.class_name ?? "unknown"),
        project_class_id:
          typeof o.project_class_id === "string" ? o.project_class_id : null,
        confidence: typeof o.confidence === "number" ? o.confidence : 1,
        x: Number(o.x) || 0,
        y: Number(o.y) || 0,
        width: Number(o.width) || 0.1,
        height: Number(o.height) || 0.1,
      };
    });
}

export function serializeAnnotations(boxes: AnnotationBox[]) {
  return boxes.map(({ id, ...rest }) => ({ id, ...rest }));
}
