/**
 * Where the big logo and the host stand on the stage background.
 *
 * The background is drawn with `background-size: cover` (centered), so a
 * point in the image maps to the screen via the cover scale and offset.
 * The logo's sofa feet are anchored on the round stage floor of the image.
 * Port of place() from docs/brand/intro-reference.html, plus a rule that
 * keeps the buttons from covering the sofa.
 */

/**
 * Reference positions in background pixels. Host and logo form ONE group:
 * the host stands on the stage left of the logo, his right edge overlaps the
 * logo image slightly (only its transparent area / star-burst tips), and the
 * group is centered. The x values define the group's center and overlap –
 * the layout itself follows the rule in computeStageLayout.
 */
export const STAGE_IMAGES = {
  /** stage-wide.webp – group centered at x 836, overlap 14 % of the logo width. */
  wide: { w: 1672, h: 941, hostX: 484, hostY: 772, hostH: 520, logoW: 820, sofaX: 1014, sofaY: 735 },
  /** stage-tall.webp (phones) – the group may be wider than the screen. */
  tall: { w: 941, h: 1672, hostX: 175, hostY: 1060, hostH: 440, logoW: 600, sofaX: 640, sofaY: 1040 },
} as const;

/** The host may overlap the logo image by at most this share of the logo width. */
export const MAX_OVERLAP_SHARE = 0.14;
/** Landscape: the group is at most this wide (share of the viewport). */
export const MAX_GROUP_WIDTH_SHARE = 0.96;

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
  /** Host image box overlapping the logo image box, in px (≤ 14 % of the logo width). */
  overlap: number;
  /** Walk-in start: translateX that puts the host fully off-screen on the left. */
  hostStartX: number;
}

const HOST_RATIO = HOST_IMAGE.w / HOST_IMAGE.h;

/** Group center and overlap share, derived from a background's reference positions. */
export function groupReference(bg: (typeof STAGE_IMAGES)[keyof typeof STAGE_IMAGES]) {
  const hostW = bg.hostH * HOST_RATIO;
  const hostLeft = bg.hostX - hostW / 2;
  const logoLeft = bg.sofaX - bg.logoW * LOGO_IMAGE.sofaX;
  const overlap = hostLeft + hostW - logoLeft;
  return {
    centerX: (hostLeft + logoLeft + bg.logoW) / 2,
    overlapShare: Math.min(MAX_OVERLAP_SHARE, Math.max(0, overlap / bg.logoW)),
  };
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
  const ref = groupReference(bg);

  // background-size: cover, centered
  const s = Math.max(W / bg.w, H / bg.h);
  const ox = (W - bg.w * s) / 2;
  const oy = (H - bg.h * s) / 2;

  // Group scale relative to the background (1 = reference size).
  let k = 1;
  const centerX = ox + ref.centerX * s;
  let sofaY = oy + bg.sofaY * s;
  let hostY = oy + bg.hostY * s;

  // Ultra-wide / short screens: the sofa would stand below the buttons. Put it
  // as low as allowed and shrink the whole group (as if further away).
  const maxFeetY = actionsTop - 12;
  if (sofaY > maxFeetY) {
    k = Math.max(0.6, 1 - (sofaY - maxFeetY) / H);
    sofaY = maxFeetY;
    // The host keeps standing a little in front of the sofa (scaled with the group).
    hostY = sofaY + (bg.hostY - bg.sofaY) * s * k;
  }
  hostY = Math.min(hostY, H - 4);

  const size = () => {
    const lw = bg.logoW * s * k;
    const hh = bg.hostH * s * k;
    const hw = hh * HOST_RATIO;
    const overlap = lw * ref.overlapShare;
    return { lw, lh: lw * ratio, hh, hw, overlap, groupW: hw + lw - overlap };
  };
  let m = size();
  // Neither logo nor host may stick out at the top.
  const fitTop = Math.min(1, (sofaY - 8) / m.lh, (hostY - 8) / m.hh);
  if (fitTop < 1) {
    k *= fitTop;
    m = size();
  }
  // Landscape: the group stays within 96 % of the width – both shrink together.
  if (!portrait && m.groupW > W * MAX_GROUP_WIDTH_SHARE) {
    k *= (W * MAX_GROUP_WIDTH_SHARE) / m.groupW;
    m = size();
  }

  const groupLeft = centerX - m.groupW / 2;
  const host: Rect = { left: groupLeft, top: hostY - m.hh, width: m.hw, height: m.hh };
  const logoLeft = host.left + host.width - m.overlap;
  const logo: Rect = { left: logoLeft, top: sofaY - m.lh * LOGO_IMAGE.feetY, width: m.lw, height: m.lh };

  return {
    portrait,
    logo,
    host,
    feet: { x: logoLeft + m.lw * LOGO_IMAGE.sofaX, y: sofaY },
    hostFeet: { x: host.left + host.width / 2, y: hostY },
    overlap: m.overlap,
    hostStartX: -(host.left + host.width + 40),
  };
}
