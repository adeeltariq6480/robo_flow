/** Read image width/height from PNG or JPEG header bytes. */
export function parseImageDimensions(buffer: Uint8Array): {
  width: number;
  height: number;
} | null {
  if (buffer.length < 24) return null;

  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // JPEG: FF D8
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = (buffer[offset + 2] << 8) + buffer[offset + 3];
      if (length < 2) break;

      // SOF0, SOF1, SOF2
      if (marker >= 0xc0 && marker <= 0xc3) {
        const height = (buffer[offset + 5] << 8) + buffer[offset + 6];
        const width = (buffer[offset + 7] << 8) + buffer[offset + 8];
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += 2 + length;
    }
  }

  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    const width = buffer[6] + (buffer[7] << 8);
    const height = buffer[8] + (buffer[9] << 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    // VP8X extended
    if (
      buffer[12] === 0x56 &&
      buffer[13] === 0x50 &&
      buffer[14] === 0x38 &&
      buffer[15] === 0x58 &&
      buffer.length >= 30
    ) {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return { width, height };
    }
  }

  return null;
}

export async function fetchImageDimensions(
  signedUrl: string
): Promise<{ width: number; height: number } | null> {
  const res = await fetch(signedUrl, {
    headers: { Range: "bytes=0-65535" },
  });
  if (!res.ok && res.status !== 206) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return parseImageDimensions(buf);
}
