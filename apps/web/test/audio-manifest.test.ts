import { describe, expect, it } from "vitest";
import { loopPoints, parseAudioManifest } from "../src/lib/audio/manifest";

describe("audio.json", () => {
  it("reads loop points from an object keyed by id", () => {
    const m = parseAudioManifest({
      lobby: { file: "lobby.mp3", role: "loop", loopStart: 0.5, loopEnd: 64.5 },
      jingle: { file: "jingle.mp3", role: "jingle" },
    });
    expect(m.lobby).toMatchObject({ url: "/audio/lobby.mp3", loop: true, loopStart: 0.5, loopEnd: 64.5 });
    expect(m.jingle).toMatchObject({ url: "/audio/jingle.mp3", loop: false });
  });

  it("reads an array under `files` with names from the file", () => {
    const m = parseAudioManifest({ files: [{ file: "think.mp3", loopStart: 0.5, loopEnd: 30.5 }, { file: "sting-short.mp3" }] });
    expect(m.think).toMatchObject({ loop: true, loopStart: 0.5, loopEnd: 30.5 });
    expect(m["sting-short"].url).toBe("/audio/sting-short.mp3");
  });

  it("falls back to <id>.mp3 for every sound", () => {
    const m = parseAudioManifest(null);
    expect(m.fanfare.url).toBe("/audio/fanfare.mp3");
    expect(m.lobby.loop).toBe(true);
  });

  it("never loops the whole file (lead-in and tail are skipped)", () => {
    const m = parseAudioManifest(null);
    expect(loopPoints(m.lobby, 60)).toEqual({ start: 0.5, end: 59.5 });
    expect(loopPoints({ ...m.lobby, loopStart: 1.25, loopEnd: 40 }, 60)).toEqual({ start: 1.25, end: 40 });
  });
});

describe("the real audio.json", () => {
  it("has all sounds with the right files and loop points", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync(new URL("../public/audio/audio.json", import.meta.url), "utf8"));
    const m = parseAudioManifest(raw);
    expect(m.lobby).toMatchObject({ url: "/audio/lobby.mp3", loop: true, loopStart: 0.5, loopEnd: 95.702, gain: 1 });
    expect(m.think).toMatchObject({ url: "/audio/think.mp3", loop: true, loopStart: 0.5, loopEnd: 92.753 });
    expect(m["sting-short"]).toMatchObject({ url: "/audio/sting-short.mp3", loop: false }); // key "stingShort"
    for (const id of ["jingle", "sting", "fanfare"] as const) expect(m[id]).toMatchObject({ url: `/audio/${id}.mp3`, loop: false });
  });
});
