import type { SurvivalEvent, SurvivalPublicPlayer } from "@couch-clash/games/meta";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAudioManifest } from "../src/lib/audio/manifest";
import { SOUND_IDS, SURVIVAL_LOOP_IDS } from "../src/lib/audio/scenes";
import { SPLASH_IMPACT_MS, ambienceFor, decaySecond, freshEvents, soundsFor } from "../src/games/survival/sounds";

const T0 = 1_700_000_000_000;
const ev = (type: SurvivalEvent["type"], extra: Partial<SurvivalEvent> = {}): SurvivalEvent => ({ seq: 1, type, at: T0, ...extra });
const ctx = { step: "question" as const, now: T0 };

describe("survival sounds: event → sound", () => {
  it("each event gets its sound from docs/survival-sounds.md", () => {
    expect(soundsFor([ev("FINALE_STARTED")], { step: "intro", now: T0 })).toEqual([{ id: "survival-intro", delayMs: 0, maxLateMs: 3000 }]);
    expect(soundsFor([ev("FAST_CORRECT")], ctx)).toEqual([{ id: "survival-bonus", delayMs: 0 }]);
    expect(soundsFor([ev("WRONG_ANSWER")], ctx).map((c) => c.id)).toEqual(["survival-wrong", "survival-elevator-jolt"]);
    expect(soundsFor([ev("TIMEOUT")], ctx).map((c) => c.id)).toEqual(["survival-wrong", "survival-elevator-jolt"]);
    expect(soundsFor([{ type: "DECAY_TICK", playerIds: ["a"] }], ctx)).toEqual([{ id: "survival-decay-tick", delayMs: 0 }]);
    expect(soundsFor([ev("FINAL_TWO")], ctx)).toEqual([{ id: "survival-final-two", delayMs: 0 }]);
    expect(soundsFor([ev("WINNER")], { step: "winner", now: T0 })).toEqual([{ id: "survival-winner", delayMs: 0 }]);
  });

  it("the splash lands on the impact in the slime – late TVs catch up, old eliminations stay silent", () => {
    expect(soundsFor([ev("ELIMINATED")], ctx)).toEqual([{ id: "survival-splash", delayMs: SPLASH_IMPACT_MS }]);
    expect(soundsFor([ev("ELIMINATED")], { ...ctx, now: T0 + 1000 })).toEqual([{ id: "survival-splash", delayMs: SPLASH_IMPACT_MS - 1000 }]);
    expect(soundsFor([ev("ELIMINATED")], { ...ctx, now: T0 + 10_000 })).toEqual([]);
    // A TV clock a bit behind the server never pushes the splash past the impact.
    expect(soundsFor([ev("ELIMINATED")], { ...ctx, now: T0 - 200 })).toEqual([{ id: "survival-splash", delayMs: SPLASH_IMPACT_MS }]);
  });

  it("several players at once: each sound only once; a finale for two has no extra final-two sound in the intro", () => {
    expect(soundsFor([ev("WRONG_ANSWER", { playerId: "a" }), ev("WRONG_ANSWER", { playerId: "b" })], ctx)).toHaveLength(2);
    expect(soundsFor([ev("FINALE_STARTED"), ev("SCORES_CONVERTED"), ev("FINAL_TWO")], { step: "intro", now: T0 }).map((c) => c.id)).toEqual([
      "survival-intro",
    ]);
  });

  it("events without a sound", () => {
    for (const type of ["SCORES_CONVERTED", "PHASE_CHANGED", "TIME_DECAY_STARTED", "WARNING", "CRITICAL", "NEAR_ELIMINATION", "COMEBACK", "MULTIPLE_PLAYERS_CRITICAL", "SUDDEN_DEATH", "TIEBREAK"] as const) {
      expect(soundsFor([ev(type)], ctx), type).toEqual([]);
    }
  });

  it("decay ticks: one per booked −10 – nothing at the threshold itself", () => {
    const q = { decayFrom: T0 + 10_000, timeoutAt: T0 + 20_000 };
    expect(decaySecond(q, T0 + 10_000)).toBeNull();
    expect(decaySecond(q, T0 + 10_900)).toBeNull();
    expect(decaySecond(q, T0 + 11_000)).toBe(1);
    expect(decaySecond(q, T0 + 14_500)).toBe(4);
    expect(decaySecond(q, T0 + 25_000)).toBe(10);
  });

  it("a TV that just appeared still hears the last seconds (the intro), never old events", () => {
    const events = [ev("FINALE_STARTED", { at: T0 }), ev("WRONG_ANSWER", { at: T0 - 60_000 })];
    expect(freshEvents(events, T0 + 1000).map((e) => e.type)).toEqual(["FINALE_STARTED"]);
  });
});

describe("survival sounds: loops follow the danger", () => {
  const rules = { wrongAnswerPenalty: 200, scoreDecayPerSecond: 10, moderatorCaptions: false, danger: { warning: 3, critical: 2, imminent: 1 } };
  const p = (id: string, score: number, eliminated = false) => ({ id, score, eliminated }) as SurvivalPublicPlayer;
  const amb = (players: SurvivalPublicPlayer[], scores: Record<string, number> = {}, step: "question" | "winner" = "question") =>
    ambienceFor({ players, rules, step }, scores);

  it("slime always; threat from CRITICAL, louder the worse; lamp only at ELIMINATION_IMMINENT", () => {
    expect(amb([p("a", 1000), p("b", 700)])).toEqual({ slime: true, threat: 0, lamp: false });
    expect(amb([p("a", 1000), p("b", 400)])).toEqual({ slime: true, threat: 0.5, lamp: false });
    expect(amb([p("a", 300), p("b", 400)])).toEqual({ slime: true, threat: 0.75, lamp: false });
    expect(amb([p("a", 1000), p("b", 150)])).toEqual({ slime: true, threat: 1, lamp: true });
  });

  it("uses the live scores (decay) and ignores the eliminated; winner: calm", () => {
    expect(amb([p("a", 1000), p("b", 250)], { b: 190 })).toMatchObject({ lamp: true });
    expect(amb([p("a", 1000), p("b", 0, true)])).toMatchObject({ threat: 0, lamp: false });
    expect(amb([p("a", 100)], {}, "winner")).toEqual({ slime: true, threat: 0, lamp: false });
  });
});

describe("survival sound files", () => {
  it("every id has its file in public/audio – MP3 one-shots, seamless WAV loops", () => {
    const raw = JSON.parse(readFileSync(new URL("../public/audio/audio.json", import.meta.url), "utf8"));
    const m = parseAudioManifest(raw);
    for (const id of SOUND_IDS) {
      const loop = (SURVIVAL_LOOP_IDS as readonly string[]).includes(id);
      expect(m[id], id).toMatchObject({ url: `/audio/${id}.${loop ? "wav" : "mp3"}`, loop });
      expect(existsSync(new URL(`../public${m[id].url}`, import.meta.url)), id).toBe(true);
    }
    // Without a manifest entry the right file is still found.
    expect(parseAudioManifest(null)["survival-slime-threat-loop"].url).toBe("/audio/survival-slime-threat-loop.wav");
  });
});
