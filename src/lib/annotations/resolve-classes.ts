import type { AnnotationBox } from "@/lib/types/annotations";
import type { Class } from "@/lib/types/database";

const EXCLUDED_NAME_PARTS = [
  "refrigerat",
  "fridge",
  "freezer",
  "cooler",
  "background",
];

/** Normalize class names for fuzzy matching (case + spaces). */
export function normalizeClassKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

export function isExcludedClassName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return EXCLUDED_NAME_PARTS.some((part) => lower.includes(part));
}

export function findClassForBox(
  box: Pick<AnnotationBox, "class_name" | "project_class_id">,
  classes: Class[]
): Class | undefined {
  if (isExcludedClassName(box.class_name)) {
    return undefined;
  }

  if (box.project_class_id) {
    const byId = classes.find((c) => c.id === box.project_class_id);
    if (byId) return byId;
  }

  const key = normalizeClassKey(box.class_name);
  if (!key) return undefined;

  return classes.find((c) => normalizeClassKey(c.name) === key);
}

/** Attach project_class_id from class_name when auto-label saved name only. */
export function resolveAnnotationBoxes(
  boxes: AnnotationBox[],
  classes: Class[]
): AnnotationBox[] {
  return boxes
    .map((box) => {
      const cls = findClassForBox(box, classes);
      if (!cls) return box;
      return {
        ...box,
        project_class_id: cls.id,
        class_name: cls.name,
      };
    })
    .filter((box) => !isExcludedClassName(box.class_name));
}
