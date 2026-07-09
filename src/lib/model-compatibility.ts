/** Universal model hints — worker tries all compatible runtimes per model. */

export function isLikelyCompatibleModelName(_name: string): boolean {
  return true;
}

export function isLikelyLegacyModelName(name: string): boolean {
  const n = name.toLowerCase();
  return /yolov5|yolov7|yolov3|pepsi|legacy/.test(n);
}

/** Start with no selection — user picks models explicitly (avoids hidden extras). */
export function defaultLabelModelIds(
  _models: Array<{ id: string; name: string }>
): string[] {
  return [];
}
