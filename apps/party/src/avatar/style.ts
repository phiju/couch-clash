// The host artwork is the style reference for every avatar. It is bundled
// into the worker as a Data module (see "rules" in wrangler.jsonc).
import hostArtwork from "../../../web/public/brand/host.webp";
import type { AvatarImage } from "./provider";

const reference: AvatarImage = { bytes: new Uint8Array(hostArtwork), mimeType: "image/webp" };

export function styleReference(): AvatarImage {
  return reference;
}
