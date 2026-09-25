/**
 * Where the big logo and the host stand on the stage background.
 *
 * The background is drawn with `background-size: cover` (centered), so a
 * point in the image maps to the screen via the cover scale and offset.
 * The logo's sofa feet are anchored on the round stage floor of the image.
 * Port of place() from docs/brand/intro-reference.html, plus a rule that
 * keeps the buttons from covering the sofa.
 */

export const STAGE_IMAGES = {
  /** stage-wide.webp – the host stands on the round stage left of the logo. */
  wide: { w: 1672, h: 941, floorX: 836, floorY: 735, logoW: 760, hostX: 420, hostY: 790, hostH: 520 },
  /** stage-tall.webp – may cut the host slightly at the left edge on narrow phones. */
  tall: { w: 941, h: 1672, floorX: 470, floorY: 1040, logoW: 860, hostX: 180, hostY: 1060, hostH: 500 },
} as const;

/** logo.webp: 1100×731, sofa center at 64 % width, sofa feet at 98.8 % height. */
export const LOGO_IMAGE = { w: 1100, h: 731, sofaX: 0.64, feetY: 0.988 } as const;
/** host.webp: 520×1123, shoes at the very bottom, figure centered horizontally. */
export const HOST_IMAGE = { w: 520, h: 1123 } as const;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StageLayout {
  portrait: boolean;
  logo: Rect;
  host: Rect;
  /** Point on screen where the sofa feet stand (transform-origin for the pop). */
  feet: { x: number; y: number };
  /** Point on screen where the host's shoes stand (on the round stage). */
  hostFeet: { x: number; y: number };
}

/**
 * @param width, height  viewport size
 * @param actionsTop     y of the top edge of the button area (they must not cover the sofa)
 */
export function computeStageLayout(width: number, height: number, actionsTop = height): StageLayout {
  const W = width;
  const H = height;
  const portrait = W / H <= 0.75;
  const bg = portrait ? STAGE_IMAGES.tall : STAGE_IMAGES.wide;
  const ratio = LOGO_IMAGE.h / LOGO_IMAGE.w;

  // background-size: cover, centered
  const s = Math.max(W / bg.w, H / bg.h);
  const ox = (W - bg.w * s) / 2;
  const oy = (H - bg.h * s) / 2;

  let lw = Math.min(bg.logoW * s, W * 0.96);
  const fx = ox + bg.floorX * s;
  let fy = oy + bg.floorY * s;

  // Ultra-wide / short screens: the floor anchor can sit below the buttons
  // (or even below the screen). Put the sofa as far down as allowed – the
  // front of the visible stage – and make the logo smaller, as if it stood
  // further away.
  const maxFeetY = actionsTop - 12;
  if (fy > maxFeetY) {
    const shrink = Math.max(0.6, 1 - (fy - maxFeetY) / H);
    fy = maxFeetY;
    lw *= shrink;
  }

  let lh = lw * ratio;
  if (fy - lh < 8) {
    lh = fy - 8;
    lw = lh / ratio;
  }
  if (portrait) {
    lw = Math.min(lw, W * 0.74);
    lh = lw * ratio;
  }

  let left = fx - lw * LOGO_IMAGE.sofaX;
  left = Math.max(W * 0.02, Math.min(left, W * 0.98 - lw));
  if (portrait) left = W * 0.96 - lw; // phones: logo to the right, host on the left

  const logo: Rect = { left, top: fy - lh * LOGO_IMAGE.feetY, width: lw, height: lh };

  // The host stands ON the round stage: his shoes (bottom center of host.webp)
  // on a fixed point of the background, his height in background pixels.
  const hh = bg.hostH * s;
  const hw = hh * (HOST_IMAGE.w / HOST_IMAGE.h);
  const hostFeet = { x: ox + bg.hostX * s, y: oy + bg.hostY * s };
  const host: Rect = { left: hostFeet.x - hw / 2, top: hostFeet.y - hh, width: hw, height: hh };

  return { portrait, logo, host, feet: { x: left + lw * LOGO_IMAGE.sofaX, y: fy }, hostFeet };
}
