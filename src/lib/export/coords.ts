import type { AnnotationBox } from "@/lib/types/annotations";
import type { Class } from "@/lib/types/database";

export interface PixelBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  width: number;
  height: number;
}

export function yoloToPixelBox(
  box: Pick<AnnotationBox, "x" | "y" | "width" | "height">,
  imageWidth: number,
  imageHeight: number
): PixelBox {
  const w = box.width * imageWidth;
  const h = box.height * imageHeight;
  const cx = box.x * imageWidth;
  const cy = box.y * imageHeight;
  const xmin = cx - w / 2;
  const ymin = cy - h / 2;
  return {
    xmin,
    ymin,
    xmax: xmin + w,
    ymax: ymin + h,
    width: w,
    height: h,
  };
}

export function buildClassIndex(classes: Class[]): Map<string, number> {
  const sorted = [...classes].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
  );
  const map = new Map<string, number>();
  sorted.forEach((c, i) => {
    map.set(c.id, i);
    map.set(c.name.toLowerCase(), i);
  });
  return map;
}

export function resolveClassIndex(
  box: AnnotationBox,
  classIndex: Map<string, number>
): number {
  if (box.project_class_id && classIndex.has(box.project_class_id)) {
    return classIndex.get(box.project_class_id)!;
  }
  const byName = classIndex.get(box.class_name.toLowerCase());
  if (byName !== undefined) return byName;
  return 0;
}

export function resolveClassName(
  box: AnnotationBox,
  classes: Class[],
  classIndex: Map<string, number>
): string {
  if (box.project_class_id) {
    const cls = classes.find((c) => c.id === box.project_class_id);
    if (cls) return cls.name;
  }
  return box.class_name;
}

export function labelBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function fmt6(n: number) {
  return n.toFixed(6);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
