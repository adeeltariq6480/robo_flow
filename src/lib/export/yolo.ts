import type { ExportDataset, ZipEntry } from "@/lib/export/types";
import {
  buildClassIndex,
  fmt6,
  labelBaseName,
  resolveClassIndex,
} from "@/lib/export/coords";

export function buildYoloExport(data: ExportDataset): ZipEntry[] {
  const classIndex = buildClassIndex(data.classes);
  const classNames = [...data.classes]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((c) => c.name);

  const entries: ZipEntry[] = [
    {
      path: "classes.txt",
      content: classNames.join("\n") + (classNames.length ? "\n" : ""),
    },
    {
      path: "data.yaml",
      content: buildDataYaml(data.datasetName, classNames),
    },
    {
      path: "README.txt",
      content: [
        `Dataset: ${data.datasetName}`,
        `Project: ${data.projectName}`,
        `Exported approved labels only`,
        `Images: ${data.files.length}`,
        "",
        "Structure:",
        "  images/                      — approved image files",
        "  labels/<image_basename>.txt  — YOLO format (class cx cy w h, normalized)",
        "  classes.txt                  — class names, one per line",
        "  data.yaml                    — YOLO dataset config",
      ].join("\n"),
    },
  ];

  for (const file of data.files) {
    const lines = file.annotations.map((box) => {
      const idx = resolveClassIndex(box, classIndex);
      return `${idx} ${fmt6(box.x)} ${fmt6(box.y)} ${fmt6(box.width)} ${fmt6(box.height)}`;
    });
    entries.push({
      path: `labels/${labelBaseName(file.fileName)}.txt`,
      content: lines.join("\n") + (lines.length ? "\n" : ""),
    });
  }

  return entries;
}

function buildDataYaml(datasetName: string, classNames: string[]) {
  const namesBlock = classNames
    .map((name, i) => `  ${i}: ${JSON.stringify(name)}`)
    .join("\n");
  return [
    `# Axiom AI export — approved labels only`,
    `path: .`,
    `train: images`,
    `val: images`,
    `names:`,
    namesBlock,
    `nc: ${classNames.length}`,
    `roboflow_dataset: ${JSON.stringify(datasetName)}`,
    "",
  ].join("\n");
}
