/** Auto names for Stock check uploads: test_1.jpg, test_2.png, … */

const TEST_NAME_RE = /^test[_\s-]?(\d+)/i;

export function nextTestImageIndex(existingFileNames: string[]): number {
  let max = 0;
  for (const name of existingFileNames) {
    const base = name.replace(/\.[^.]+$/, "");
    const m = base.match(TEST_NAME_RE);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function renameAsTestImage(file: File, index: number): File {
  const extMatch = file.name.match(/(\.[a-z0-9]+)$/i);
  const ext = extMatch?.[1]?.toLowerCase() || ".jpg";
  const safeExt = /^\.(jpe?g|png|webp|gif|bmp)$/i.test(ext) ? ext : ".jpg";
  return new File([file], `test_${index}${safeExt}`, {
    type: file.type || "image/jpeg",
    lastModified: file.lastModified,
  });
}

/** UI title: test_1.jpg → "test 1" */
export function displayTestName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const m = base.match(TEST_NAME_RE);
  if (m) return `test ${m[1]}`;
  return fileName;
}
