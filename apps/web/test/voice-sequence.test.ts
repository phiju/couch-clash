import type { HostLine } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { lineAudioPaths, sequenceSchedule } from "../src/lib/voice/sequence";

const line = (over: Partial<HostLine> = {}): HostLine => ({
  id: "1",
  kind: "comment",
  text: "Max … Mutig geraten.",
  audioPath: "/api/voice-cache/v/snark/line.mp3",
  playbackRate: 1,
  staleAfterMs: 2500,
  ...over,
});

describe("name clip + line playback", () => {
  it("plays the name clip first, then the line", () => {
    expect(lineAudioPaths(line({ prefixAudioPath: "/api/voice-cache/v/names/max.mp3", prefixGapMs: 150 }))).toEqual([
      "/api/voice-cache/v/names/max.mp3",
      "/api/voice-cache/v/snark/line.mp3",
    ]);
    expect(lineAudioPaths(line())).toEqual(["/api/voice-cache/v/snark/line.mp3"]);
  });

  it("back to back with a 150 ms gap (and the turbo rate)", () => {
    expect(sequenceSchedule([0.6, 2], 150)).toEqual({ offsets: [0, 0.75], totalMs: 2750 });
    const turbo = sequenceSchedule([1.1, 2.2], 150, 1.1);
    expect(turbo.offsets[1]).toBeCloseTo(1.15);
    expect(turbo.totalMs).toBe(3150);
    expect(sequenceSchedule([2], 150)).toEqual({ offsets: [0], totalMs: 2000 });
  });
});
