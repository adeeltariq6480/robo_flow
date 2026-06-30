import type { Class } from "@/lib/types/database";

/** Value for "no specific class" / show all classes */
export const ALL_CLASS_ID = "";

export const ALL_CLASS_LABEL = "All";

export function parseClassNamesInput(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item).trim())
          .filter((name) => name.length > 0);
      }
    } catch {
      /* fall through to line/comma parsing */
    }
  }

  return trimmed
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export function fileMatchesClassFilter(
  file: {
    annotations: { project_class_id?: string | null; class_name?: string }[];
    class_id?: string | null;
  },
  classId: string,
  classes: Class[]
): boolean {
  if (!classId || classId === ALL_CLASS_ID) return true;

  const cls = classes.find((c) => c.id === classId);
  if (file.class_id === classId) return true;

  return file.annotations.some(
    (box) =>
      box.project_class_id === classId ||
      (cls && box.class_name?.toLowerCase() === cls.name.toLowerCase())
  );
}
