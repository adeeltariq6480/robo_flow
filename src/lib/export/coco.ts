import type { ExportDataset } from "@/lib/export/types";
import {
  buildClassIndex,
  resolveClassIndex,
  yoloToPixelBox,
} from "@/lib/export/coords";

export function buildCocoExport(data: ExportDataset): string {
  const sortedClasses = [...data.classes].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
  );

  const categories = sortedClasses.map((c, i) => ({
    id: i + 1,
    name: c.name,
    supercategory: "object",
  }));

  const categoryIdByClass = new Map<string, number>();
  sortedClasses.forEach((c, i) => {
    categoryIdByClass.set(c.id, i + 1);
    categoryIdByClass.set(c.name.toLowerCase(), i + 1);
  });

  const classIndex = buildClassIndex(data.classes);

  const images: Array<{
    id: number;
    file_name: string;
    width: number;
    height: number;
  }> = [];

  const annotations: Array<{
    id: number;
    image_id: number;
    category_id: number;
    bbox: [number, number, number, number];
    area: number;
    iscrowd: 0;
    score?: number;
  }> = [];

  let annId = 1;

  data.files.forEach((file, imageIdx) => {
    const imageId = imageIdx + 1;
    images.push({
      id: imageId,
      file_name: file.fileName,
      width: file.width,
      height: file.height,
    });

    for (const box of file.annotations) {
      const px = yoloToPixelBox(box, file.width, file.height);
      const classIdx = resolveClassIndex(box, classIndex);
      const cls = sortedClasses[classIdx];
      const categoryId =
        (cls && categoryIdByClass.get(cls.id)) ||
        categoryIdByClass.get(box.class_name.toLowerCase()) ||
        1;

      const bbox: [number, number, number, number] = [
        round2(px.xmin),
        round2(px.ymin),
        round2(px.width),
        round2(px.height),
      ];

      annotations.push({
        id: annId++,
        image_id: imageId,
        category_id: categoryId,
        bbox,
        area: round2(px.width * px.height),
        iscrowd: 0,
        score: round4(box.confidence),
      });
    }
  });

  const coco = {
    info: {
      description: `Axiom AI export — ${data.datasetName}`,
      version: "1.0",
      year: new Date().getFullYear(),
      contributor: data.projectName,
      date_created: new Date().toISOString(),
      note: "Approved labels only",
    },
    licenses: [{ id: 1, name: "Unknown", url: "" }],
    categories,
    images,
    annotations,
  };

  return JSON.stringify(coco, null, 2);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
