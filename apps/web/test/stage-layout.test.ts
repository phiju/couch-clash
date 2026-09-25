import { describe, expect, it } from "vitest";
import {
  computeStageLayout,
  groupReference,
  HOST_IMAGE,
  LOGO_IMAGE,
  MAX_GROUP_WIDTH_SHARE,
  MAX_OVERLAP_SHARE,
  STAGE_IMAGES,
} from "../src/lib/stage-layout";

/** Where a point of the background image lands on screen (cover, centered). */
function coverPoint(W: number, H: number, x: number, y: number) {
  const bg = W / H <= 0.75 ? STAGE_IMAGES.tall : STAGE_IMAGES.wide;
  const s = Math.max(W / bg.w, H / bg.h);
  return { x: (W - bg.w * s) / 2 + x * s, y: (H - bg.h * s) / 2 + y * s, s, bg };
}

const SIZES: [string, number, number][] = [
  ["1280x720", 1280, 720],
  ["1920x1080", 1920, 1080],
  ["2560x1080", 2560, 1080],
  ["1024x768", 1024, 768],
  ["390x844", 390, 844],
  ["360x780", 360, 780],
];
const LANDSCAPE = SIZES.filter(([, W, H]) => W / H > 0.75);
const MORE: [string, number, number][] = [
  ["TV 4K", 3840, 2160],
  ["Laptop", 1440, 900],
  ["Ultra-wide", 3440, 1440],
  ["Super ultra-wide", 3840, 1080],
  ["Small phone", 360, 640],
  ["Tall phone", 412, 915],
];

describe("reference positions", () => {
  it("stage-wide: group centered at x 836, overlap = 14 % of the logo (115 px)", () => {
    const ref = groupReference(STAGE_IMAGES.wide);
    expect(ref.centerX).toBeCloseTo(836, 0);
    expect(ref.overlapShare * STAGE_IMAGES.wide.logoW).toBeCloseTo(115, 0);
    expect(ref.overlapShare).toBeLessThanOrEqual(MAX_OVERLAP_SHARE);
  });

  it("1672x941 (the image itself): exactly the reference values", () => {
    const { host, hostFeet, logo, feet } = computeStageLayout(1672, 941);
    expect(hostFeet.x).toBeCloseTo(484, 0);
    expect(hostFeet.y).toBeCloseTo(772, 3);
    expect(host.height).toBeCloseTo(520, 3);
    expect(logo.width).toBeCloseTo(820, 3);
    expect(feet.x).toBeCloseTo(1014, 0);
    expect(feet.y).toBeCloseTo(735, 3);
  });
});

describe("host + logo group", () => {
  it.each([...SIZES, ...MORE])("%s: overlap ≤ 14 % of the logo width, host left of the logo", (_n, W, H) => {
    const { host, logo, overlap } = computeStageLayout(W, H);
    const real = host.left + host.width - logo.left;
    expect(real).toBeCloseTo(overlap, 6);
    expect(real).toBeGreaterThanOrEqual(0);
    expect(real).toBeLessThanOrEqual(logo.width * MAX_OVERLAP_SHARE + 1e-6);
    expect(host.left).toBeLessThan(logo.left);
    expect(host.width / host.height).toBeCloseTo(HOST_IMAGE.w / HOST_IMAGE.h, 6);
    expect(logo.height / logo.width).toBeCloseTo(LOGO_IMAGE.h / LOGO_IMAGE.w, 6);
  });

  it.each(LANDSCAPE)("%s: group centered (±2 %) and within 96 % of the width", (_n, W, H) => {
    const { host, logo } = computeStageLayout(W, H);
    const left = host.left;
    const right = logo.left + logo.width;
    expect(Math.abs((left + right) / 2 - W / 2)).toBeLessThanOrEqual(W * 0.02);
    expect(right - left).toBeLessThanOrEqual(W * MAX_GROUP_WIDTH_SHARE + 0.5);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(W);
  });

  it.each([...SIZES, ...MORE])("%s: logo and host visible at the top, shoes on screen", (_n, W, H) => {
    const { host, logo, hostFeet } = computeStageLayout(W, H);
    expect(logo.top).toBeGreaterThanOrEqual(0);
    expect(host.top).toBeGreaterThanOrEqual(0);
    expect(hostFeet.y).toBeLessThanOrEqual(H);
  });

  it.each(SIZES)("%s: feet on the background anchors (unconstrained)", (_n, W, H) => {
    const { feet, hostFeet, portrait } = computeStageLayout(W, H);
    const bg = portrait ? STAGE_IMAGES.tall : STAGE_IMAGES.wide;
    const sofa = coverPoint(W, H, bg.sofaX, bg.sofaY);
    const shoes = coverPoint(W, H, bg.hostX, bg.hostY);
    expect(feet.y).toBeCloseTo(Math.min(sofa.y, H - 12), 0);
    expect(hostFeet.y).toBeCloseTo(Math.min(shoes.y, H - 4), 0);
  });

  it("phones: the group may be wider than the screen but the logo stays on it", () => {
    for (const [W, H] of [
      [390, 844],
      [360, 780],
      [360, 640],
    ] as const) {
      const { host, logo, portrait } = computeStageLayout(W, H);
      expect(portrait).toBe(true);
      expect(logo.left + logo.width).toBeLessThanOrEqual(W + 2);
      expect(host.left).toBeGreaterThanOrEqual(-host.width * 0.25); // at most slightly cut
    }
  });

  it("walk-in starts fully off-screen on the left", () => {
    for (const [, W, H] of SIZES) {
      const { host, hostStartX } = computeStageLayout(W, H);
      expect(host.left + host.width + hostStartX).toBeLessThanOrEqual(-40 + 1e-6);
    }
  });
});

describe("buttons never cover the sofa", () => {
  it.each([
    [3840, 1080],
    [3440, 1440],
    [1920, 1080],
    [2560, 1080],
    [390, 844],
  ] as const)("%ix%i: sofa above the buttons, group still centered", (W, H) => {
    const actionsTop = H * 0.8;
    const { feet, logo, host } = computeStageLayout(W, H, actionsTop);
    expect(feet.y).toBeLessThanOrEqual(actionsTop - 12 + 0.01);
    expect(logo.top).toBeGreaterThanOrEqual(0);
    if (W / H > 0.75) {
      const center = (host.left + logo.left + logo.width) / 2;
      expect(Math.abs(center - W / 2)).toBeLessThanOrEqual(W * 0.02);
    }
  });

  it("super ultra-wide: the whole group gets smaller to stay above the buttons", () => {
    const normal = computeStageLayout(3840, 1080);
    const constrained = computeStageLayout(3840, 1080, 1080 * 0.8);
    expect(constrained.logo.width).toBeLessThan(normal.logo.width);
    expect(constrained.host.height).toBeLessThan(normal.host.height);
    expect(constrained.logo.width / constrained.host.height).toBeCloseTo(normal.logo.width / normal.host.height, 6);
  });
});
