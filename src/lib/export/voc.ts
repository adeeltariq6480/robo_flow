import type { ExportDataset, ZipEntry } from "@/lib/export/types";
import {
  buildClassIndex,
  escapeXml,
  labelBaseName,
  resolveClassName,
  yoloToPixelBox,
} from "@/lib/export/coords";

export function buildVocExport(data: ExportDataset): ZipEntry[] {
  const classIndex = buildClassIndex(data.classes);
  const entries: ZipEntry[] = [
    {
      path: "README.txt",
      content: [
        `Dataset: ${data.datasetName}`,
        `Pascal VOC XML — approved labels only`,
        `Place images in an 'images/' folder alongside these XML files.`,
      ].join("\n"),
    },
  ];

  for (const file of data.files) {
    entries.push({
      path: `annotations/${labelBaseName(file.fileName)}.xml`,
      content: buildVocXml(file, data, classIndex),
    });
  }

  return entries;
}

function buildVocXml(
  file: ExportDataset["files"][number],
  data: ExportDataset,
  classIndex: Map<string, number>
): string {
  const objects = file.annotations
    .map((box) => {
      const px = yoloToPixelBox(box, file.width, file.height);
      const name = escapeXml(
        resolveClassName(box, data.classes, classIndex)
      );
      return `  <object>
    <name>${name}</name>
    <pose>Unspecified</pose>
    <truncated>0</truncated>
    <difficult>0</difficult>
    <bndbox>
      <xmin>${Math.round(px.xmin)}</xmin>
      <ymin>${Math.round(px.ymin)}</ymin>
      <xmax>${Math.round(px.xmax)}</xmax>
      <ymax>${Math.round(px.ymax)}</ymax>
    </bndbox>
  </object>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<annotation>
  <folder>images</folder>
  <filename>${escapeXml(file.fileName)}</filename>
  <path>${escapeXml(file.fileName)}</path>
  <source>
    <database>Robo Flow</database>
    <annotation>Robo Flow</annotation>
    <project>${escapeXml(data.projectName)}</project>
    <dataset>${escapeXml(data.datasetName)}</dataset>
  </source>
  <size>
    <width>${file.width}</width>
    <height>${file.height}</height>
    <depth>3</depth>
  </size>
  <segmented>0</segmented>
${objects}
</annotation>
`;
}
