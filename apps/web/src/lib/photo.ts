/**
 * Client-side photo preparation: centered square crop, at most 512 px,
 * JPEG ~0.8. Drawing to a canvas and re-encoding drops all EXIF data
 * (location, camera, …) – only pixels leave the phone.
 */
export const PHOTO_OUTPUT_SIZE = 512;
export const PHOTO_JPEG_QUALITY = 0.8;

export interface SquareCrop {
  sx: number;
  sy: number;
  side: number;
  size: number;
}

/** Largest centered square, scaled down to `max` px (never up). */
export function squareCrop(width: number, height: number, max = PHOTO_OUTPUT_SIZE): SquareCrop {
  const side = Math.min(width, height);
  return {
    sx: Math.round((width - side) / 2),
    sy: Math.round((height - side) / 2),
    side,
    size: Math.max(1, Math.min(max, side)),
  };
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // Applies the EXIF orientation, so selfies are upright.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // fall through (e.g. older Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Throws if the file is not a decodable image. */
export async function preparePhoto(file: Blob): Promise<Blob> {
  const image = await decode(file);
  try {
    const crop = squareCrop(image.width, image.height);
    const canvas = document.createElement("canvas");
    canvas.width = crop.size;
    canvas.height = crop.size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(image.source, crop.sx, crop.sy, crop.side, crop.side, 0, 0, crop.size, crop.size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_JPEG_QUALITY));
    if (!blob) throw new Error("encode failed");
    return blob;
  } finally {
    image.close();
  }
}
