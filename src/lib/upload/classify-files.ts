const MODEL_EXTENSIONS = new Set([
  "onnx",
  "pt",
  "pth",
  "pb",
  "h5",
  "tflite",
  "zip",
]);

const CLASS_FILE_EXTENSIONS = new Set(["txt", "json", "csv"]);

export interface ClassifiedFiles {
  images: File[];
  models: File[];
  classFiles: File[];
  other: File[];
}

function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|bmp|gif|tif|tiff)$/i.test(file.name);
}

export function isModelFile(file: File): boolean {
  return MODEL_EXTENSIONS.has(fileExtension(file.name));
}

export function isClassListFile(file: File): boolean {
  return CLASS_FILE_EXTENSIONS.has(fileExtension(file.name));
}

export function classifyDroppedFiles(files: File[]): ClassifiedFiles {
  const images: File[] = [];
  const models: File[] = [];
  const classFiles: File[] = [];
  const other: File[] = [];

  for (const file of files) {
    if (isImageFile(file)) images.push(file);
    else if (isModelFile(file)) models.push(file);
    else if (isClassListFile(file)) classFiles.push(file);
    else other.push(file);
  }

  return { images, models, classFiles, other };
}

export async function readFileAsText(file: File): Promise<string> {
  return file.text();
}
