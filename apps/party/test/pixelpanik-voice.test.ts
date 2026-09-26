import type { PixelpanikEvent, PixelpanikState } from "@couch-clash/games";
import type { HostLine } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { NAME, PIXELPANIK_LINES, PIXELPANIK_SITUATIONS, fillName, linesFor } from "../src/voice/pixelpanik-lines";
import {
  PIXELPANIK_VOICE_CONFIG,
  PixelpanikVoice,
  choosePixelpanikLine,
  createPixelpanikMemory,
  pixelpanikTexts,
  type PixelpanikChooseInput,
} from "../src/voice/pixelpanik-voice";
import type { SurvivalVoiceRuntime } from "../src/voice/survival-voice";

const T0 = 1_700_000_000_000;
const names = { a: "Anna", b: "Ben" };
let seq = 0;
const ev = (type: PixelpanikEvent["type"], extra: Partial<PixelpanikEvent> = {}): PixelpanikEvent => ({
  seq: ++seq,
  type,
  at: T0,
  index: 0,
  stage: 0,
  ...extra,
});

function input(over: Partial<PixelpanikChooseInput> = {}): PixelpanikChooseInput {
  let s = 3;
  return {
    mode: "family",
    names,
    now: T0,
    random: () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296,
    ready: () => true,
    ...over,
  };
}

describe("Pixelpanik lines", () => {
  it("8–10 family lines per situation, extra Party and Kids lines, all unique", () => {
    const all: string[] = [];
    for (const situation of PIXELPANIK_SITUATIONS) {
      const pools = PIXELPANIK_LINES[situation];
      expect(pools.family.length, situation).toBeGreaterThanOrEqual(8);
      expect(pools.family.length, situation).toBeLessThanOrEqual(10);
      expect(pools.party.length, situation).toBeGreaterThanOrEqual(8);
      expect(pools.kids.length, situation).toBeGreaterThanOrEqual(8);
      all.push(...pools.family, ...pools.party, ...pools.kids);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it("every line about a player has the {name} placeholder; 'nobody' has none", () => {
    for (const situation of PIXELPANIK_SITUATIONS) {
      const { family, party, kids } = PIXELPANIK_LINES[situation];
      for (const line of [...family, ...party, ...kids]) {
        expect(line.includes(NAME), `${situation}: ${line}`).toBe(situation !== "nobody");
        expect(line.length).toBeLessThanOrEqual(110);
      }
    }
    expect(fillName("Raus, {name}.", "Max")).toBe("Raus, Max.");
  });

  it("Party mode adds the cheekier lines, Kids only get kids lines", () => {
    expect(linesFor("wrong", "party")).toEqual([...PIXELPANIK_LINES.wrong.family, ...PIXELPANIK_LINES.wrong.party]);
    expect(linesFor("wrong", "kids")).toEqual(PIXELPANIK_LINES.wrong.kids);
    expect(linesFor("wrong", "family")).toEqual(PIXELPANIK_LINES.wrong.family);
  });
});

describe("choosing a line", () => {
  it("the most important situation wins and the line is about its player", () => {
    const { pick } = choosePixelpanikLine(
      [ev("WRONG", { playerId: "a" }), ev("EARLY_CORRECT", { playerId: "b" }), ev("CORRECT", { playerId: "a" })],
      createPixelpanikMemory(),
      input(),
    );
    expect(pick?.situation).toBe("earlyCorrect");
    expect(pick?.text).toContain("Ben");
    expect(PIXELPANIK_LINES.earlyCorrect.family).toContain(pick?.template);
  });

  it("the last 3 lines of a situation are locked", () => {
    let memory = createPixelpanikMemory();
    const seen: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = choosePixelpanikLine([ev("WRONG", { playerId: "a", at: T0 + i * 5_000 })], memory, input({ now: T0 + i * 5_000 }));
      expect(r.pick).not.toBeNull();
      expect(seen.slice(-PIXELPANIK_VOICE_CONFIG.lockedPerSituation)).not.toContain(r.pick!.template);
      seen.push(r.pick!.template);
      memory = r.memory;
    }
    expect(memory.recent.wrong).toHaveLength(3);
  });

  it("only lines with audio ready; nothing ready → silence", () => {
    const only = fillName(PIXELPANIK_LINES.wrong.family[4]!, "Anna");
    const r = choosePixelpanikLine([ev("WRONG", { playerId: "a" })], createPixelpanikMemory(), input({ ready: (t) => t === only }));
    expect(r.pick?.text).toBe(only);
    expect(choosePixelpanikLine([ev("WRONG", { playerId: "a" })], createPixelpanikMemory(), input({ ready: () => false })).pick).toBeNull();
  });

  it("keeps a gap between lines – except 'nobody' at the solution; old events are ignored", () => {
    const first = choosePixelpanikLine([ev("WRONG", { playerId: "a" })], createPixelpanikMemory(), input());
    expect(choosePixelpanikLine([ev("WRONG", { playerId: "b", at: T0 + 500 })], first.memory, input({ now: T0 + 500 })).pick).toBeNull();
    expect(choosePixelpanikLine([ev("NOBODY", { at: T0 + 500 })], first.memory, input({ now: T0 + 500 })).pick?.situation).toBe("nobody");
    expect(choosePixelpanikLine([ev("WRONG", { playerId: "a" })], createPixelpanikMemory(), input({ now: T0 + 10_000 })).pick).toBeNull();
  });

  it("Kids hear kids lines, Party may hear party lines", () => {
    const kids = choosePixelpanikLine([ev("WRONG", { playerId: "a" })], createPixelpanikMemory(), input({ mode: "kids" }));
    expect(PIXELPANIK_LINES.wrong.kids).toContain(kids.pick?.template);
    const partyTemplates = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = choosePixelpanikLine([ev("NOBODY_YET", { playerId: "a" })], createPixelpanikMemory(), input({ mode: "party", random: () => i / 40 }));
      partyTemplates.add(r.pick!.template);
    }
    expect([...partyTemplates].some((t) => PIXELPANIK_LINES.nobodyYet.party.includes(t))).toBe(true);
    expect(partyTemplates.has("{name}, so sieht die Welt nach dem vierten Aperol aus.")).toBe(true);
  });
});

describe("PixelpanikVoice", () => {
  function runtime(over: Partial<SurvivalVoiceRuntime> = {}) {
    const sent: HostLine[] = [];
    const tasks: Promise<void>[] = [];
    let now = T0;
    let id = 0;
    const rt: SurvivalVoiceRuntime = {
      enabled: () => true,
      allowNew: () => true,
      clip: async (text, allowNew, reserve) => {
        if (!allowNew) return { path: null, cached: false };
        return (await reserve(30)) ? { path: `voice-cache/${text.length}-${id++}.mp3`, cached: false } : { path: null, cached: false };
      },
      reserveCredits: async () => true,
      send: (line) => {
        sent.push(line);
        return true;
      },
      playbackRate: () => 1,
      now: () => now,
      random: () => 0.5,
      newId: () => `line-${id++}`,
      run: (task) => void tasks.push(task()),
      log: () => {},
      ...over,
    };
    return { rt, sent, tasks, setNow: (t: number) => (now = t) };
  }

  const state = (events: PixelpanikEvent[], roundKey = "r1") => ({ roundKey, events }) as unknown as PixelpanikState;

  it("warms up at the round start, then speaks about new events only", async () => {
    const { rt, sent, tasks, setNow } = runtime();
    const voice = new PixelpanikVoice(rt);
    voice.roomChanged(state([]), names, "family");
    await Promise.all(tasks);
    expect(voice.readyCount).toBeGreaterThan(0);
    setNow(T0 + 100);
    voice.roomChanged(state([ev("WRONG", { playerId: "a", at: T0 + 50 })]), names, "family");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Anna");
    expect(sent[0]!.staleAfterMs).toBe(PIXELPANIK_VOICE_CONFIG.staleAfterMs);
  });

  it("stays within the round's credit cap", async () => {
    let spent = 0;
    const { rt, tasks } = runtime({ reserveCredits: async (c) => ((spent += c), true) });
    const voice = new PixelpanikVoice(rt);
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}`, `Spieler${i}`]));
    voice.roomChanged(state([]), many, "party");
    await Promise.all(tasks);
    expect(spent).toBeLessThanOrEqual(PIXELPANIK_VOICE_CONFIG.maxNewCreditsPerRound);
    // Nameless lines come first, then a few named lines per player.
    const texts = pixelpanikTexts("party", many);
    expect(texts.nameless.length).toBe(PIXELPANIK_LINES.nobody.family.length + PIXELPANIK_LINES.nobody.party.length);
    expect(texts.first.length).toBe(10 * 4 * PIXELPANIK_VOICE_CONFIG.namedFirst);
  });
});
