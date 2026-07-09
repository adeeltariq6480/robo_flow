/** Universal model hints — worker tries all compatible runtimes per model. */

export function isLikelyCompatibleModelName(_name: string): boolean {
  return true;
}

export function isLikelyLegacyModelName(name: string): boolean {
  const n = name.toLowerCase();
  return /yolov5|yolov7|yolov3|pepsi|legacy/.test(n);
}

/** Default: all uploaded models (multi-model auto-label). */
export function defaultLabelModelIds(
  models: Array<{ id: string; name: string }>
): string[] {
  return models.map((m) => m.id);
}
