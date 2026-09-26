import type { SurvivalEvent } from "@couch-clash/games";
import type { HostLine } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import {
  COMMENTARY_CONFIG,
  chooseComment,
  createCommentaryMemory,
  type CommentaryInput,
  type CommentaryMemory,
} from "../src/voice/survival-commentary";
import { SURVIVAL_LINES, namelessLines } from "../src/voice/survival-lines";
import { SurvivalVoice, type SurvivalVoiceRuntime } from "../src/voice/survival-voice";
import { createSurvivalModule, type SurvivalState } from "@couch-clash/games";

const T0 = 1_700_000_000_000;
const names = { a: "Anna", b: "Ben" };
let seq = 0;
const ev = (type: SurvivalEvent["type"], extra: Partial<SurvivalEvent> = {}): SurvivalEvent => ({ seq: ++seq, type, at: T0, ...extra });

function input(over: Partial<CommentaryInput> = {}): CommentaryInput {
  let s = 3;
  return {
    now: T0,
    names,
    decaySeconds: { phase1: 10, phase2: 8, phase3: 6, death: 4 },
    random: () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    },
    ready: () => true,
    ...over,
  };
}

describe("commentary engine", () => {
  it("one comment per batch – the most important event wins", () => {
    const { comment } = chooseComment(
      [ev("FAST_CORRECT", { playerId: "b" }), ev("WRONG_ANSWER", { playerId: "a" }), ev("ELIMINATED", { playerId: "a" })],
      createCommentaryMemory(),
      input(),
    );
    expect(comment?.event.type).toBe("ELIMINATED");
    expect(comment?.preempt).toBe(true);
    expect(SURVIVAL_LINES.ELIMINATED.map((t) => t.replace("{playerName}", "Anna"))).toContain(comment?.text);
    // "PLATSCH!" lands on the splash.
    expect(comment?.playAt).toBe(T0 + COMMENTARY_CONFIG.splashImpactMs);
  });

  it("never the same line twice in a row (a pool of lines, no repeats)", () => {
    let memory: CommentaryMemory = createCommentaryMemory();
    const seen: string[] = [];
    for (let i = 0; i < SURVIVAL_LINES.ELIMINATED.length; i++) {
      const r = chooseComment([ev("ELIMINATED", { playerId: i % 2 ? "a" : "b" })], memory, input({ now: T0 + i * 60_000 }));
      memory = r.memory;
      seen.push(r.comment!.template);
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("cooldowns: the host is present but doesn't talk non-stop (big moments ignore them)", () => {
    let memory = chooseComment([ev("WRONG_ANSWER", { playerId: "a" })], createCommentaryMemory(), input()).memory;
    // 1 s later: normal comments wait for the global cooldown …
    expect(chooseComment([ev("FAST_CORRECT", { playerId: "b" })], memory, input({ now: T0 + 1000 })).comment).toBeNull();
    // … an elimination doesn't.
    expect(chooseComment([ev("ELIMINATED", { playerId: "b" })], memory, input({ now: T0 + 1000 })).comment?.event.type).toBe("ELIMINATED");
    // After the global cooldown, the same player still waits (per-player cooldown), another player doesn't.
    const later = T0 + COMMENTARY_CONFIG.globalCooldownMs + 100;
    expect(chooseComment([ev("CRITICAL", { playerId: "a" })], memory, input({ now: later })).comment).toBeNull();
    memory = chooseComment([ev("CRITICAL", { playerId: "b" })], memory, input({ now: later })).memory;
    expect(memory.players.b?.lastAt).toBe(later);
  });

  it("a named line without ready audio falls back to a nameless one from the same pool", () => {
    const ready = (text: string) => !text.includes("Anna");
    for (let i = 0; i < 20; i++) {
      const { comment } = chooseComment([ev("ELIMINATED", { playerId: "a" })], createCommentaryMemory(), input({ ready, random: () => i / 20 }));
      expect(comment?.text).not.toContain("Anna");
      expect(SURVIVAL_LINES.ELIMINATED).toContain(comment?.text);
    }
  });

  it("no audio ready at all → no comment (the game never waits)", () => {
    const r = chooseComment([ev("WINNER", { playerId: "a" })], createCommentaryMemory(), input({ ready: () => false }));
    expect(r.comment).toBeNull();
  });

  it("the decay line uses the current phase's seconds", () => {
    const only = (t: string) => t.startsWith("8 Sekunden") || t.startsWith("10 Sekunden");
    const { comment } = chooseComment([ev("TIME_DECAY_STARTED", { playerIds: ["a", "b"], phase: "phase2" })], createCommentaryMemory(), input({ ready: only }));
    expect(comment?.text).toBe("8 Sekunden! Ab jetzt kostet Nachdenken.");
  });

  it("running gag: slow twice → 'Der Schleim ist UNTEN', later a wrong answer → 'Du erinnerst dich also doch'", () => {
    let memory = createCommentaryMemory();
    let now = T0;
    const step = (e: SurvivalEvent) => {
      now += 60_000;
      const r = chooseComment([e], memory, input({ now }));
      memory = r.memory;
      return r.comment?.text;
    };
    step(ev("TIME_DECAY_STARTED", { playerIds: ["a"], phase: "phase1" }));
    expect(step(ev("TIME_DECAY_STARTED", { playerIds: ["a"], phase: "phase1" }))).toBe("Anna, wir hatten das doch besprochen. Der Schleim ist UNTEN.");
    expect(step(ev("WRONG_ANSWER", { playerId: "a" }))).toBe("Ah. Du erinnerst dich also doch, wo er ist.");
    expect(memory.players.a?.slow).toBe(2);
  });

  it("running gag: 'du magst Schleim, oder?' → rescued → wrong again", () => {
    let memory = createCommentaryMemory();
    const ready = (t: string) => t !== "Oh oh, Anna … der Schleim kommt näher." && (t.includes("Schleim, oder") || !t.includes("Anna"));
    // Force the slime-fan line from the WARNING pool.
    const onlyFan = (t: string) => t === "Anna, du magst Schleim, oder?";
    memory = chooseComment([ev("WARNING", { playerId: "a" })], memory, input({ ready: onlyFan })).memory;
    expect(memory.players.a?.gags.slimeFan).toBe(0);
    const r1 = chooseComment([ev("COMEBACK", { playerId: "a" })], memory, input({ now: T0 + 60_000, ready }));
    expect(r1.comment?.text).toBe("Ach! Plötzlich doch kein Schleim-Fan mehr?");
    const r2 = chooseComment([ev("WRONG_ANSWER", { playerId: "a" })], r1.memory, input({ now: T0 + 120_000, ready }));
    expect(r2.comment?.text).toBe("WUSSTE ICH'S DOCH. Schleim-Fan.");
  });

  it("every nameless line exists once per phase threshold, none still has a placeholder", () => {
    const lines = namelessLines([10, 8, 6, 4]);
    expect(lines.some((l) => l.includes("{"))).toBe(false);
    expect(lines).toContain("6 Sekunden! Ab jetzt kostet Nachdenken.");
    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe("survival voice (runtime)", () => {
  function state(): SurvivalState {
    const mod = createSurvivalModule();
    return mod.init(
      { now: T0, players: [{ id: "a", connected: true }, { id: "b", connected: true }], random: () => 0.3, scores: { a: 100, b: 50 } },
      { questionCount: 1, scoring: mod.meta.scoring, excludeContentIds: [] },
    ).state;
  }

  function runtime(over: Partial<SurvivalVoiceRuntime> = {}) {
    const sent: HostLine[] = [];
    const cues: string[] = [];
    const tasks: Promise<void>[] = [];
    let id = 0;
    const rt: SurvivalVoiceRuntime = {
      enabled: () => true,
      allowNew: () => true,
      clip: async (text) => ({ path: `/api/voice-cache/x/snark/${text.length}.mp3`, cached: true }),
      reserveCredits: async () => true,
      send: (line) => {
        sent.push(line);
        return true;
      },
      playbackRate: () => 1,
      now: () => T0 + 500,
      random: () => 0.1,
      newId: () => `l${++id}`,
      run: (task) => {
        tasks.push(task());
      },
      log: () => {},
      cue: (cue) => cues.push(cue),
      ...over,
    };
    return { rt, sent, cues, settle: () => Promise.all(tasks) };
  }

  it("warms up at the start, then speaks the intro line with priority and queue age", async () => {
    const { rt, sent, settle } = runtime();
    const voice = new SurvivalVoice(rt);
    const s = state();
    voice.roomChanged(s, { a: "Anna", b: "Ben" });
    await settle();
    expect(voice.readyCount).toBeGreaterThan(100);
    // The intro's events waited for the cache check; with two players FINAL_TWO is the most important one.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "comment", priority: 4 });
    expect(SURVIVAL_LINES.FINAL_TWO).toContain(sent[0]!.text);
    sent.length = 0;
    const later = { ...s, events: [...s.events, { seq: 99, type: "ELIMINATED" as const, at: T0 + 400, playerId: "b" }] };
    voice.roomChanged(later, { a: "Anna", b: "Ben" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "comment", priority: 2, preempt: true, staleAfterMs: 2500, playAt: T0 + 400 + 1350 });
  });

  it("voice service down: no lines, no errors – the finale just goes on (no waiting for a line)", async () => {
    const { rt, sent, cues, settle } = runtime({ clip: async () => ({ path: null, cached: false, refused: true }) });
    const voice = new SurvivalVoice(rt);
    const s = state();
    voice.roomChanged(s, { a: "Anna" });
    await settle();
    voice.roomChanged({ ...s, events: [...s.events, { seq: 50, type: "WINNER", at: T0, playerId: "a" }] }, { a: "Anna" });
    expect(voice.readyCount).toBe(0);
    expect(sent).toEqual([]);
    expect(cues).toEqual(["ceremony"]);
  });

  it("start sequence: the opening line after the pause – the ride starts when it ended", async () => {
    const { rt, sent, cues, settle } = runtime();
    const voice = new SurvivalVoice(rt);
    const s = state();
    voice.roomChanged(s, { a: "Anna", b: "Ben" });
    await settle();
    sent.length = 0;
    const launch = [
      { seq: 20, type: "LAUNCH" as const, at: T0 + 400, playerIds: ["a", "b"] },
      { seq: 21, type: "SCORES_CONVERTED" as const, at: T0 + 400, playerIds: ["a", "b"] },
    ];
    voice.roomChanged({ ...s, step: "launch", events: [...s.events, ...launch] }, { a: "Anna", b: "Ben" });
    expect(sent).toHaveLength(1);
    expect(SURVIVAL_LINES.FINALE_STARTED).toContain(sent[0]!.text);
    expect(sent[0]!.playAt).toBe(T0 + 400 + 1000);
    expect(cues).toEqual([]);
    voice.lineEnded("nope");
    expect(cues).toEqual([]);
    voice.lineEnded(sent[0]!.id);
    expect(cues).toEqual(["launch"]);
    voice.lineEnded(sent[0]!.id);
    expect(cues).toEqual(["launch"]);
  });

  it("winner: the WINNER line after the ride up, right after it „ab zur Siegerehrung“ – the ceremony follows its end", async () => {
    const { rt, sent, cues, settle } = runtime();
    const voice = new SurvivalVoice(rt);
    const s = state();
    voice.roomChanged(s, { a: "Anna", b: "Ben" });
    await settle();
    sent.length = 0;
    voice.roomChanged({ ...s, step: "winner", events: [...s.events, { seq: 40, type: "WINNER", at: T0 + 400, playerId: "a" }] }, { a: "Anna", b: "Ben" });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ priority: 1, preempt: true, playAt: T0 + 400 + 1500 });
    expect(sent[1]).toMatchObject({ priority: 1, staleAfterMs: 15_000 });
    expect(SURVIVAL_LINES.TRANSITION_TO_CEREMONY).toContain(sent[1]!.text);
    voice.lineEnded(sent[0]!.id);
    expect(cues).toEqual([]);
    voice.lineEnded(sent[1]!.id);
    expect(cues).toEqual(["ceremony"]);
  });

  it("voice switched off: the finale never waits for a line", () => {
    const { rt, sent, cues } = runtime({ enabled: () => false });
    const voice = new SurvivalVoice(rt);
    const s = state();
    voice.roomChanged(s, { a: "Anna" });
    voice.roomChanged({ ...s, step: "launch", events: [...s.events, { seq: 20, type: "LAUNCH", at: T0, playerIds: ["a"] }] }, { a: "Anna" });
    expect(sent).toEqual([]);
    expect(cues).toEqual(["launch"]);
  });

  it("a room that restarts mid-finale never replays old events", () => {
    const { rt, sent } = runtime({ now: () => T0 + 60_000 });
    const voice = new SurvivalVoice(rt);
    const s = state();
    voice.roomChanged({ ...s, step: "question" }, { a: "Anna" });
    expect(sent).toEqual([]);
  });
});
