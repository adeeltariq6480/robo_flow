/** Heuristic hints — worker may still fail on load; ultralytics YOLOv8/v11 is safest on Railway. */

export function isLikelyCompatibleModelName(name: string): boolean {
  const n = name.toLowerCase();
  return /yolo(v)?(8|9|10|11)|yolo11|yolov11|ultralytics/.test(n);
}

export function isLikelyLegacyModelName(name: string): boolean {
  const n = name.toLowerCase();
  if (isLikelyCompatibleModelName(n)) return false;
  return (
    /yolov5|yolov7|yolov3|pepsi|legacy|custom/.test(n) ||
    n.includes("v5") ||
    n.includes("v7")
  );
}

export function defaultLabelModelIds(
  models: Array<{ id: string; name: string }>
): string[] {
  const compatible = models.filter((m) => isLikelyCompatibleModelName(m.name));
  if (compatible.length > 0) return compatible.map((m) => m.id);
  return models[0] ? [models[0].id] : [];
}
