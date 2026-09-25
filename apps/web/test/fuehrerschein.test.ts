import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GAME_MODULES } from "@couch-clash/games";
import { ARMS, VEHICLE_TYPES, exitArm, type Arm, type QuestionMedia, type SceneMedia, type VehicleType } from "@couch-clash/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DRIVE, driveProgress, driveSchedule, driveTotalMs, fuehrerscheinAudio } from "../src/games/fuehrerschein/logic";
import { C, R, armU, armV, layoutSigns, layoutVehicles, pointAlong, polyline, roadOutline } from "../src/games/fuehrerschein/scene-layout";
import { TrafficScene, describeScene } from "../src/games/fuehrerschein/traffic-scene";

const SIGN_DIR = join(__dirname, "../public/signs");
const questions = GAME_MODULES.fuehrerschein.listContent!().map((e) => e.payload as { id: string; text: string; media: QuestionMedia | null });

describe("traffic sign files", () => {
  it("every sign a question uses has a file in public/signs", () => {
    const used = new Set<string>();
    for (const q of questions) {
      if (q.media?.kind === "sign") q.media.signs.forEach((s) => used.add(s));
      if (q.media?.kind === "scene") Object.values(q.media.signs).forEach((list) => list?.forEach((s) => used.add(s)));
    }
    expect(used.size).toBeGreaterThan(30);
    for (const sign of used) expect(existsSync(join(SIGN_DIR, `${sign}.svg`)), sign).toBe(true);
  });

  it("keeps the source / licence note", () => {
    expect(readdirSync(SIGN_DIR)).toContain("SOURCES.md");
  });
});

describe("scene geometry (right-hand traffic, N = top)", () => {
  it("arm vectors: outward u, v = right-hand side of a driver coming in", () => {
    expect(armU("N")).toEqual({ x: 0, y: -1 });
    expect(armV("N")).toEqual({ x: -1, y: 0 }); // coming from N (driving down) → right is west
    expect(armV("S")).toEqual({ x: 1, y: 0 });
    expect(armV("E")).toEqual({ x: 0, y: -1 });
    expect(exitArm("S", "left")).toBe("W");
    expect(exitArm("S", "right")).toBe("E");
    expect(exitArm("E", "straight")).toBe("W");
  });

  const scene = (vehicles: SceneMedia["vehicles"], arms: Arm[] = [...ARMS]): SceneMedia => ({ kind: "scene", arms, signs: {}, priorityPath: null, vehicles });

  it("vehicles wait in the right-hand lane before the junction, facing it", () => {
    const [south, east] = layoutVehicles(
      scene([
        { id: "rot", type: "car", color: "rot", from: "S", turn: "straight" },
        { id: "blau", type: "car", color: "blau", from: "E", turn: "left" },
      ]),
    );
    expect(south!.pos.x).toBeGreaterThan(C); // east half of the south arm
    expect(south!.pos.y).toBeGreaterThan(C + R); // before the junction
    expect(south!.angle).toBe(0); // nose up (driving north)
    expect(east!.pos.y).toBeLessThan(C); // north half of the east arm
    expect(east!.angle).toBe(270); // nose left (driving west)
  });

  it("paths end in the right arm: left turn from S leaves to the west on the northern lane", () => {
    const [v] = layoutVehicles(scene([{ id: "rot", type: "car", color: "rot", from: "S", turn: "left" }]));
    const end = pointAlong(polyline(v!.path), 1);
    expect(end.pos.x).toBeLessThan(0);
    expect(end.pos.y).toBeLessThan(C);
    expect(Math.round(end.angle)).toBe(270);
    const mid = pointAlong(polyline(v!.path), 0.5);
    expect(mid.angle).toBeGreaterThan(270 - 90); // turning
  });

  it("trams run on the middle of the road, bikes at the right edge", () => {
    const [tram, bike] = layoutVehicles(
      scene([
        { id: "gelb", type: "tram", color: "gelb", from: "N", turn: "straight" },
        { id: "grün", type: "bike", color: "grün", from: "S", turn: "straight" },
      ]),
    );
    expect(tram!.pos.x).toBe(C);
    expect(bike!.pos.x).toBeGreaterThan(C + R / 2);
  });

  it("signs stand on the grass at the right-hand side, before the junction, never on the road", () => {
    const signs = layoutSigns({ ...scene([]), signs: { N: ["306", "1002-10"], E: ["205"], S: ["206"], W: ["205", "1002-21"] } });
    for (const s of signs) {
      // The whole stack is beyond the road edge on the driver's right, and before the junction.
      const u = armU(s.arm);
      const v = armV(s.arm);
      for (const [x, y] of [[s.x, s.y], [s.x + 96, s.y], [s.x, s.postBottom], [s.x + 96, s.postBottom]] as const) {
        expect((x - C) * v.x + (y - C) * v.y, `${s.arm} beside the road`).toBeGreaterThan(R);
        expect((x - C) * u.x + (y - C) * u.y, `${s.arm} before the junction`).toBeGreaterThan(R);
      }
    }
    expect(signs.find((s) => s.arm === "S")!.x).toBeGreaterThan(C + R); // right of northbound drivers
  });

  it("T-junction: no road where the arm is missing", () => {
    expect(roadOutline(["E", "S", "W"])).not.toMatch(/ -?\d+(\.\d)? -3\d\d/);
    expect(roadOutline(["N", "E", "S", "W"])).toMatch(/Q/);
  });
});

describe("scene rendering", () => {
  const html = (media: SceneMedia, driveOrder: string[] | null = null) =>
    renderToStaticMarkup(createElement(TrafficScene, { scene: media, driveOrder }));

  it("snapshot per vehicle type and arm", () => {
    const out: Record<string, string> = {};
    for (const type of VEHICLE_TYPES) {
      for (const from of ARMS) {
        const media: SceneMedia = {
          kind: "scene",
          arms: [...ARMS],
          signs: { [from]: ["205"] },
          priorityPath: null,
          vehicles: [{ id: "rot", type, color: "rot", from, turn: from === "N" ? "left" : from === "S" ? "right" : "straight", siren: type === "police" }],
        };
        out[`${type}:${from}`] = html(media).replace(/_R_[a-z0-9_]+_/gi, "ID");
      }
    }
    expect(out).toMatchSnapshot();
  });

  it("every scene of the content renders with colour chips and never with A/B/C/D labels", () => {
    for (const q of questions) {
      if (q.media?.kind !== "scene") continue;
      const markup = html(q.media);
      for (const v of q.media.vehicles) expect(markup, q.id).toContain(`>${{ rot: "Rot", blau: "Blau", grün: "Grün", gelb: "Gelb" }[v.color]}<`);
      expect(markup).not.toMatch(/>[ABCD]</);
      for (const signs of Object.values(q.media.signs)) for (const s of signs ?? []) expect(markup).toContain(`/signs/${s}.svg`);
    }
  });

  it("blinkers only for turning vehicles; siren only when on", () => {
    const base: SceneMedia = { kind: "scene", arms: [...ARMS], signs: {}, priorityPath: null, vehicles: [] };
    const car = (turn: "left" | "straight") => ({ id: "rot", type: "car" as VehicleType, color: "rot" as const, from: "S" as Arm, turn });
    expect(html({ ...base, vehicles: [car("left")] })).toContain("ts-blink");
    expect(html({ ...base, vehicles: [car("straight")] })).not.toContain("ts-blink");
    const police = { id: "blau", type: "police" as VehicleType, color: "blau" as const, from: "W" as Arm, turn: "straight" as const };
    expect(html({ ...base, vehicles: [{ ...police, siren: true }] })).toContain("ts-siren");
    expect(html({ ...base, vehicles: [police] })).not.toContain('class="ts-siren"');
  });

  it("the reveal numbers the order on the chips; screen-reader text names everyone", () => {
    const q = questions.find((x) => x.id === "fs-118")!;
    const media = q.media as SceneMedia;
    const markup = html(media, ["grün", "blau", "rot"]);
    expect(markup).toMatch(/>1<\/text>.*>Grün</s);
    expect(describeScene(media)).toBe(
      "Kreuzung. Rot (Auto) von unten, fährt geradeaus. Blau (Auto) von rechts, fährt geradeaus. Grün (Auto) von oben, fährt geradeaus",
    );
  });
});

describe("reveal drive-through", () => {
  it("one after the other, 3–5 s in total for 2–4 actors", () => {
    const slots = driveSchedule(["blau", "rot", "grün"]);
    expect(slots.map((s) => s.id)).toEqual(["blau", "rot", "grün"]);
    expect(slots[1]!.startMs - slots[0]!.startMs).toBe(DRIVE.gapMs);
    for (const n of [2, 3, 4]) {
      const total = driveTotalMs(Array.from({ length: n }, (_, i) => `v${i}`));
      expect(total).toBeGreaterThanOrEqual(3_000);
      expect(total).toBeLessThanOrEqual(5_000);
    }
  });

  it("progress: waits, drives, gone", () => {
    const [slot] = driveSchedule(["rot"]);
    expect(driveProgress(slot, 0)).toBe(0);
    expect(driveProgress(slot, slot!.startMs + DRIVE.driveMs / 2)).toBeCloseTo(0.5);
    expect(driveProgress(slot, slot!.endMs + 1)).toBe(1);
    expect(driveProgress(undefined, 99_999)).toBe(0);
  });

  it("the whole reveal step is long enough for the drive-through of the biggest scene", async () => {
    const { FUEHRERSCHEIN_CONFIG } = await import("@couch-clash/games/meta");
    const most = Math.max(...questions.map((q) => (q.media?.kind === "scene" ? q.media.vehicles.length + (q.media.pedestrians?.length ?? 0) : 0)));
    expect(driveTotalMs(Array.from({ length: most }, (_, i) => `${i}`))).toBeLessThan(FUEHRERSCHEIN_CONFIG.sceneRevealMs);
  });
});

describe("audio", () => {
  it("exam result: quiet lobby loop with a short sting; otherwise like the quiz", () => {
    expect(fuehrerscheinAudio({ step: "summary", index: 4 })).toMatchObject({ music: "lobby", enter: "sting-short" });
    expect(fuehrerscheinAudio({ step: "question", index: 0 })).toMatchObject({ music: "think" });
  });
});
