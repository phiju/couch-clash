import { describe, expect, it } from "vitest";
import { computeStageLayout, LOGO_IMAGE, STAGE_IMAGES } from "../src/lib/stage-layout";

const VIEWPORTS: [string, number, number][] = [
  ["TV 1080p", 1920, 1080],
  ["TV 4K", 3840, 2160],
  ["Laptop", 1440, 900],
  ["Ultra-wide", 3440, 1440],
  ["Super ultra-wide", 3840, 1080],
  ["Tablet landscape", 1024, 768],
  ["iPhone", 390, 844],
  ["Small phone", 360, 640],
  ["Tall phone", 412, 915],
];

/** Where a point of the background image lands on screen (cover, centered). */
function coverPoint(W: number, H: number, x: number, y: number) {
  const bg = W / H <= 0.75 ? STAGE_IMAGES.tall : STAGE_IMAGES.wide;
  const s = Math.max(W / bg.w, H / bg.h);
  return { x: (W - bg.w * s) / 2 + x * s, y: (H - bg.h * s) / 2 + y * s, s, bg };
}

describe("computeStageLayout", () => {
  it.each(VIEWPORTS)("%s: logo stays inside the viewport", (_n, W, H) => {
    const { logo } = computeStageLayout(W, H);
    expect(logo.left).toBeGreaterThanOrEqual(W * 0.02 - 0.5);
    expect(logo.left + logo.width).toBeLessThanOrEqual(W * 0.98 + 0.5);
    expect(logo.top).toBeGreaterThanOrEqual(0);
    expect(logo.width).toBeLessThanOrEqual(W * 0.96 + 0.5);
  });

  it.each(VIEWPORTS)("%s: sofa feet stand on the stage floor anchor (if visible)", (_n, W, H) => {
    const layout = computeStageLayout(W, H);
    const anchor = coverPoint(W, H, 0, 0);
    const floor = coverPoint(W, H, anchor.bg.floorX, anchor.bg.floorY);
    // On extreme aspect ratios the anchor is cropped away – then the feet go as low as allowed.
    expect(layout.feet.y).toBeCloseTo(Math.min(floor.y, H - 12), 0);
    // feet y = top + height * 98.8 %
    expect(layout.logo.top + layout.logo.height * LOGO_IMAGE.feetY).toBeCloseTo(layout.feet.y, 3);
  });

  it("landscape: sofa is centered on the floor anchor", () => {
    const { logo, feet } = computeStageLayout(1920, 1080);
    const floor = coverPoint(1920, 1080, STAGE_IMAGES.wide.floorX, STAGE_IMAGES.wide.floorY);
    expect(feet.x).toBeCloseTo(floor.x, 0);
    expect(logo.left + logo.width * LOGO_IMAGE.sofaX).toBeCloseTo(floor.x, 0);
  });

  it("portrait: logo max 74 % wide, right edge at 96 %, host cut off at most 25 %", () => {
    for (const [W, H] of [
      [390, 844],
      [360, 640],
      [412, 915],
    ] as const) {
      const { logo, host, portrait } = computeStageLayout(W, H);
      expect(portrait).toBe(true);
      expect(logo.width).toBeLessThanOrEqual(W * 0.74 + 0.01);
      expect(logo.left + logo.width).toBeCloseTo(W * 0.96, 3);
      expect(host.left).toBeGreaterThanOrEqual(-host.width * 0.5); // at most slightly cut at the left edge
      expect(host.left).toBeLessThan(logo.left); // host stands left of the logo
    }
  });

  it("buttons never cover the sofa", () => {
    for (const [W, H] of [
      [3840, 1080],
      [3440, 1440],
      [1920, 1080],
      [390, 844],
    ] as const) {
      const actionsTop = H * 0.8;
      const { feet, logo } = computeStageLayout(W, H, actionsTop);
      expect(feet.y).toBeLessThanOrEqual(actionsTop - 12 + 0.01);
      expect(logo.top).toBeGreaterThanOrEqual(0);
    }
  });

  it("super ultra-wide: logo gets smaller to stay above the buttons", () => {
    const normal = computeStageLayout(3840, 1080);
    const constrained = computeStageLayout(3840, 1080, 1080 * 0.8);
    expect(constrained.logo.width).toBeLessThan(normal.logo.width);
  });
});

describe("host on the stage", () => {
  it.each([
    ["1280x720", 1280, 720],
    ["1920x1080", 1920, 1080],
    ["2560x1080", 2560, 1080],
    ["390x844", 390, 844],
    ["360x780", 360, 780],
  ] as const)("%s: shoes on the background anchor, height from the image", (_n, W, H) => {
    const { host, hostFeet, portrait } = computeStageLayout(W, H);
    const bg = portrait ? STAGE_IMAGES.tall : STAGE_IMAGES.wide;
    const anchor = coverPoint(W, H, bg.hostX, bg.hostY);
    expect(hostFeet.x).toBeCloseTo(anchor.x, 3);
    expect(hostFeet.y).toBeCloseTo(anchor.y, 3);
    // host.webp: shoes at the bottom, figure centered
    expect(host.top + host.height).toBeCloseTo(anchor.y, 3);
    expect(host.left + host.width / 2).toBeCloseTo(anchor.x, 3);
    expect(host.height).toBeCloseTo(bg.hostH * anchor.s, 3);
    // Shoes are visible on screen.
    expect(hostFeet.y).toBeLessThanOrEqual(H);
  });
});
