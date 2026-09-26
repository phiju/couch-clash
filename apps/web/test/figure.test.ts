import { describe, expect, it } from "vitest";
import { FIGURE_CONFIG, alignShift, currentPose, feetAnchor, idlePhase, poseForDanger, reactionForEvent, stagePose } from "../src/lib/figure";

/** A transparent RGBA image with an opaque "figure": a body rectangle and two feet. */
function figureImage(w: number, h: number, feet: { left: number; right: number; bottom: number }, bodyTop = 5) {
  const data = new Uint8ClampedArray(w * h * 4);
  const paint = (x: number, y: number) => (data[(y * w + x) * 4 + 3] = 255);
  for (let y = bodyTop; y < feet.bottom - 3; y++) for (let x = feet.left; x <= feet.right; x++) paint(x, y);
  // Feet: the last 3 rows.
  for (let y = feet.bottom - 3; y < feet.bottom; y++) {
    for (let x = feet.left; x < feet.left + 3; x++) paint(x, y);
    for (let x = feet.right - 2; x <= feet.right; x++) paint(x, y);
  }
  return data;
}

describe("figure poses", () => {
  it("SAFE / WARNING → standard, CRITICAL → besorgt, ELIMINATION_IMMINENT → panisch", () => {
    expect(["SAFE", "WARNING", "CRITICAL", "ELIMINATION_IMMINENT"].map((d) => poseForDanger(d as never))).toEqual([
      "standard",
      "standard",
      "besorgt",
      "panisch",
    ]);
  });

  it("stage pose per game state: standard, besorgt, panisch, jubelnd, geschockt", () => {
    expect(stagePose({ danger: "SAFE" })).toBe("standard");
    expect(stagePose({ danger: "WARNING" })).toBe("standard");
    // Sinking platform or few points → worried.
    expect(stagePose({ danger: "SAFE", descending: true })).toBe("besorgt");
    expect(stagePose({ danger: "CRITICAL" })).toBe("besorgt");
    // Just above the slime → panic (also while sinking).
    expect(stagePose({ danger: "ELIMINATION_IMMINENT", descending: true })).toBe("panisch");
    // Correct answer → cheering, even in danger; any loss of points → shocked.
    expect(stagePose({ danger: "ELIMINATION_IMMINENT", correct: true, pointsChange: 0 })).toBe("jubelnd");
    expect(stagePose({ danger: "SAFE", correct: false, pointsChange: -200 })).toBe("geschockt");
    expect(stagePose({ danger: "SAFE", correct: true, pointsChange: -30 })).toBe("geschockt");
    expect(stagePose({ danger: "ELIMINATED" })).toBe("geschockt");
    expect(stagePose({ danger: "CRITICAL", winner: true })).toBe("jubelnd");
  });

  it("+50 / comeback / winner → cheering briefly; wrong answer → shocked ~1.5 s; others → none", () => {
    for (const type of ["FAST_CORRECT", "COMEBACK", "WINNER"]) {
      expect(reactionForEvent(type, 1)).toEqual({ key: 1, pose: "jubelnd", durationMs: FIGURE_CONFIG.cheerMs });
    }
    expect(reactionForEvent("WRONG_ANSWER", 2)).toEqual({ key: 2, pose: "geschockt", durationMs: 1500 });
    expect(reactionForEvent("TIMEOUT", 3)).toBeNull();
    expect(reactionForEvent("CRITICAL", 4)).toBeNull();
  });

  it("a running reaction wins, then the resting pose returns", () => {
    expect(currentPose("besorgt", { pose: "jubelnd" })).toBe("jubelnd");
    expect(currentPose("besorgt", null)).toBe("besorgt");
  });

  it("idle phases differ per player and stay within one breath", () => {
    const a = idlePhase("player-a");
    const b = idlePhase("player-b");
    expect(a).not.toBe(b);
    for (const v of [a, b]) {
      expect(v).toBeLessThanOrEqual(0);
      expect(v).toBeGreaterThan(-3);
    }
    expect(idlePhase("player-a")).toBe(a);
  });
});

describe("feet alignment (no pose change makes the figure jump)", () => {
  it("finds the lowest opaque row and the middle of the feet", () => {
    const img = figureImage(40, 60, { left: 10, right: 29, bottom: 58 });
    expect(feetAnchor(img, 40, 60)).toEqual({ x: 50, y: (58 / 60) * 100 });
    expect(feetAnchor(new Uint8ClampedArray(40 * 60 * 4), 40, 60)).toBeNull();
  });

  it("a pose drawn a little higher and to the side is shifted back onto the standard figure's feet", () => {
    const standard = feetAnchor(figureImage(40, 60, { left: 10, right: 29, bottom: 58 }), 40, 60)!;
    const shocked = feetAnchor(figureImage(40, 60, { left: 6, right: 25, bottom: 55 }), 40, 60)!;
    const shift = alignShift(shocked, standard);
    expect(shocked.x + shift.x).toBeCloseTo(standard.x);
    expect(shocked.y + shift.y).toBeCloseTo(standard.y);
    // The standard figure itself never moves; unknown anchors never move anything.
    expect(alignShift(standard, standard)).toEqual({ x: 0, y: 0 });
    expect(alignShift(null, standard)).toEqual({ x: 0, y: 0 });
  });
});
