import { PIXELPANIK_MOTIFS, PIXELPANIK_STAGE_SIZES, type PixelpanikMotif } from "@couch-clash/content";
import { createPixelpanikModule } from "../../src/pixelpanik/module";

/** Stand-in picture URLs: one random-looking file per stage (like the image script writes them). */
export function fakeImage(id: string): NonNullable<PixelpanikMotif["image"]> {
  return {
    stages: PIXELPANIK_STAGE_SIZES.map((size, i) => `https://img.test/pixelpanik/${id}/${(i * 7919 + id.length * 104729).toString(36)}-${size}.png`),
  };
}

/** Every motif with pictures – the real data has none until the image script ran. */
export const MOTIFS_WITH_IMAGES: PixelpanikMotif[] = PIXELPANIK_MOTIFS.map((m) => ({ ...m, image: m.image ?? fakeImage(m.id) }));

export const pixelpanikWithImages = createPixelpanikModule({ pool: MOTIFS_WITH_IMAGES });
