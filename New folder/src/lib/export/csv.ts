import type { ExportDataset } from "@/lib/export/types";
import {
  buildClassIndex,
  escapeCsv,
  fmt6,
  resolveClassIndex,
  resolveClassName,
  yoloToPixelBox,
} from "@/lib/export/coords";

const CSV_HEADER = [
  "file_name",
  "image_width",
  "image_height",
  "class_name",
  "class_index",
  "confidence",
  "x_center_norm",
  "y_center_norm",
  "width_norm",
  "height_norm",
  "x_min",
  "y_min",
  "x_max",
  "y_max",
  "bbox_width_px",
  "bbox_height_px",
].join(",");

export function buildCsvExport(data: ExportDataset): string {
  const classIndex = buildClassIndex(data.classes);
  const rows: string[] = [CSV_HEADER];

  for (const file of data.files) {
    for (const box of file.annotations) {
      const px = yoloToPixelBox(box, file.width, file.height);
      const idx = resolveClassIndex(box, classIndex);
      const className = resolveClassName(box, data.classes, classIndex);

      rows.push(
        [
          escapeCsv(file.fileName),
          file.width,
          file.height,
          escapeCsv(className),
          idx,
          fmt6(box.confidence),
          fmt6(box.x),
          fmt6(box.y),
          fmt6(box.width),
          fmt6(box.height),
          fmt6(px.xmin),
          fmt6(px.ymin),
          fmt6(px.xmax),
          fmt6(px.ymax),
          fmt6(px.width),
          fmt6(px.height),
        ].join(",")
      );
    }
  }

  return rows.join("\n") + "\n";
}
