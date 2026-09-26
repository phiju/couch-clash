import { PIXELPANIK_STAGES, type PixelpanikPublicState } from "@couch-clash/games/meta";
import { describe, expect, it } from "vitest";
import { avatarReaction, pixelpanikAudio, pixelpanikSkipLabel } from "../src/games/pixelpanik/logic";

const stages = PIXELPANIK_STAGES.map((s, i) => ({ size: s.size, label: s.label, points: [200, 180, 150, 100, 50, 20][i]! }));
const at = (step: PixelpanikPublicState["step"], stage: number) => ({ step, stage, stages, index: 2 });

describe("Pixelpanik on the TV", () => {
  it("avatars: early hit zooms in and cheers, out is sad and dimmed", () => {
    expect(avatarReaction({ status: "correct", stage: 0 })).toEqual({ expression: "jubelnd", zoom: true, dimmed: false });
    expect(avatarReaction({ status: "correct", stage: 1 }).zoom).toBe(true);
    expect(avatarReaction({ status: "correct", stage: 2 })).toEqual({ expression: "jubelnd", zoom: false, dimmed: false });
    expect(avatarReaction({ status: "out", stage: null })).toEqual({ expression: "enttaeuscht", zoom: false, dimmed: true });
    expect(avatarReaction({ status: "open", stage: null }).expression).toBe("neutral");
    expect(avatarReaction(undefined).expression).toBe("neutral");
  });

  it("sound: think music, a sting on the snap to full resolution, the sting at the solution", () => {
    expect(pixelpanikAudio(at("stage", 0))).toEqual({ key: "stage:2", music: "think" });
    expect(pixelpanikAudio(at("stage", 4))?.key).toBe("stage:2");
    expect(pixelpanikAudio(at("stage", 5))).toMatchObject({ key: "snap:2", enter: "sting-short" });
    expect(pixelpanikAudio(at("reveal", 5))).toMatchObject({ enter: "sting", music: null });
    expect(pixelpanikAudio(at("leaderboard", 5))?.music).toBe("lobby");
  });

  it("the host's button: sharper, solve, leaderboard", () => {
    expect(pixelpanikSkipLabel(at("stage", 0))).toBe("Schärfer ⏭");
    expect(pixelpanikSkipLabel(at("stage", 5))).toBe("Auflösen ⏭");
    expect(pixelpanikSkipLabel(at("reveal", 5))).toBe("Rangliste ⏭");
  });
});
