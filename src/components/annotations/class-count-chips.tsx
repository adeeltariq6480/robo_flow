import type { AnnotationBox } from "@/lib/types/annotations";

/** Count boxes by class name — e.g. { "Pepsi 250ml": 4, "7up": 2 }. */
export function countBoxesByClass(boxes: AnnotationBox[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const box of boxes) {
    const name = (box.class_name || "unknown").trim() || "unknown";
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]))
  );
}

export function ClassCountChips({
  boxes,
  emptyLabel = "No objects",
}: {
  boxes: AnnotationBox[];
  emptyLabel?: string;
}) {
  const counts = countBoxesByClass(boxes);
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return <span className="text-xs text-slate-400">{emptyLabel}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([name, count]) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-900"
        >
          {name}: <strong>{count}</strong>
        </span>
      ))}
    </div>
  );
}
