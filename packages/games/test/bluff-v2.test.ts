import { BLUFF_WORDS_DE, type BluffWord } from "@couch-clash/content";
import type { ModuleContext, ModulePlayer, ScoringSettings } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { acceptPolished, judgePrompt, lightCleanup, localMatch, parseJudgeReply } from "../src/bluff/judge";
import { bluffMeta } from "../src/bluff/meta";
import { createBluffModule, type BluffState } from "../src/bluff/module";
import { bluffLead, bluffQuestion } from "../src/bluff/text";
import type { BluffAction } from "../src/bluff/types";

const T0 = 1_700_000_000_000;
const scoring: ScoringSettings = bluffMeta.scoring;
const SINGULTUS: BluffWord = { id: "t-singultus", article: "der", word: "Singultus", definition: "Schluckauf", ageRating: 12, tags: ["t"], difficulty: 3, alcohol: false, adult: false };
/** The case from the test round: "Wenn's weh tut" must count as correct. */
const ZIPPERLEIN: BluffWord = { id: "t-zipperlein", article: "das", word: "Zipperlein", definition: "Gicht; kleine Wehwehchen", ageRating: 12, tags: ["t"], difficulty: 2, alcohol: false, adult: false };

describe("question text with the right indefinite article", () => {
  it.each([
    [{ article: "der", word: "Borborygmus" }, "Ein Borborygmus ist …?", "Ein Borborygmus ist:"],
    [{ article: "die", word: "Glabella" }, "Eine Glabella ist …?", "Eine Glabella ist:"],
    [{ article: "das", word: "Philtrum" }, "Ein Philtrum ist …?", "Ein Philtrum ist:"],
    [{ article: "die", word: "Vibrissen", plural: true }, "Vibrissen sind …?", "Vibrissen sind:"],
  ] as const)("%o", (noun, question, lead) => {
    expect(bluffQuestion(noun)).toBe(question);
    expect(bluffLead(noun)).toBe(lead);
  });

  it("works for every word in the content", () => {
    for (const w of BLUFF_WORDS_DE) expect(bluffQuestion(w)).toMatch(/^(Ein|Eine) \S+ ist …\?$|^\S+ sind …\?$/);
  });
});

describe("judge prompt", () => {
  it("has few-shot examples incl. the Zipperlein case and asks for confidence and polished texts", () => {
    const { system, user } = judgePrompt("der Singultus", "Schluckauf", [{ key: "s1", text: "rülpsen" }]);
    expect(system).toContain("Zipperlein");
    expect(system).toContain("Wenn's weh tut");
    expect(system).toMatch(/confidence/);
    expect(system).toMatch(/polished/);
    expect(system).toMatch(/Wenn jemand/);
    expect(user).toContain("rülpsen");
  });
});

describe("judge reply parsing", () => {
  const subs = [
    { key: "s1", text: "Wenn's weh tut" },
    { key: "s2", text: "so ne art blasinstrument glaub ich" },
    { key: "s3", text: "rülpsen" },
  ];
  const reply = (over: Record<string, unknown>[] = []) => ({
    results: [
      { id: "s1", verdict: "correct", confidence: 0.85, reason: "Kern: kleine Schmerzen", polished: "Wenn es weh tut", sameIdea: true, group: 1 },
      { id: "s2", verdict: "bluff", confidence: 0.95, reason: "anderes Ding", polished: "Eine Art Blasinstrument", sameIdea: true, group: 2 },
      { id: "s3", verdict: "bluff", confidence: 0.9, reason: "Handlung", polished: "Wenn jemand aufstößt", sameIdea: true, group: 3 },
    ].map((r, i) => ({ ...r, ...(over[i] ?? {}) })),
  });

  it("takes verdicts, reasons and polished texts", () => {
    const out = parseJudgeReply(reply(), subs)!;
    expect(out.get("s1")).toMatchObject({ verdict: "correct", reason: "Kern: kleine Schmerzen", confidence: 0.85 });
    expect(out.get("s2")!.text).toBe("Eine Art Blasinstrument");
    expect(out.get("s3")!.text).toBe("Wenn jemand aufstößt");
  });

  it("an unsure \"correct\" (confidence < 0.6) counts as a bluff", () => {
    const out = parseJudgeReply(reply([{ confidence: 0.5 }]), subs)!;
    expect(out.get("s1")!.verdict).toBe("bluff");
  });

  it("unusable polished texts fall back to a light local cleanup", () => {
    const out = parseJudgeReply(
      reply([
        {},
        { polished: "Ein uraltes Blechblasinstrument aus Mesopotamien mit sieben Ventilen, das bei Hochzeiten gespielt wurde", sameIdea: true },
        { polished: "Ein Musikinstrument", sameIdea: false },
      ]),
      subs,
    )!;
    expect(out.get("s2")!.text).toBe("Art blasinstrument"); // too long → local cleanup (fillers removed)
    expect(out.get("s3")!.text).toBe("Rülpsen"); // sameIdea false → local cleanup
  });

  it("rejects exclamation marks, emojis and first person the player did not use", () => {
    expect(acceptPolished("tolles ding", "Ein tolles Ding!", true)).toBe("Tolles ding");
    expect(acceptPolished("tolles ding", "Ein tolles Ding 🎉", true)).toBe("Tolles ding");
    expect(acceptPolished("tolles ding", "Ich finde, ein tolles Ding", true)).toBe("Tolles ding");
    expect(acceptPolished("tolles ding", "Ein tolles Ding.", true)).toBe("Ein tolles Ding");
  });

  it("null for garbage or incomplete replies", () => {
    expect(parseJudgeReply("nope", subs)).toBeNull();
    expect(parseJudgeReply({ results: [{ id: "s1", verdict: "correct" }] }, subs)).toBeNull();
  });
});

describe("local cleanup and fallback check", () => {
  it("removes filler, emojis and exclamation marks, capitalizes", () => {
    expect(lightCleanup("so ne art blasinstrument glaub ich")).toBe("Art blasinstrument");
    expect(lightCleanup("komisch niesen lol")).toBe("Komisch niesen");
    expect(lightCleanup("wenn man zu viel gegessen hat und rülpst!!")).toBe("Wenn man zu viel gegessen hat und rülpst");
    expect(lightCleanup("  ein   hut 😂 ")).toBe("Ein hut");
  });

  it("equality or containment with the real definition counts as correct", () => {
    expect(localMatch("schluckauf!", "Schluckauf")).toBe(true);
    expect(localMatch("Gänsehaut", "Gänsehaut, das Aufrichten der Körperhaare")).toBe(true);
    expect(localMatch("Kleine Wehwehchen", ZIPPERLEIN.definition)).toBe(true);
    expect(localMatch("ein Hut", "Schluckauf")).toBe(false);
    expect(localMatch("das", "Das Erbrechen")).toBe(false); // too short to count
  });
});

// ── In the module ─────────────────────────────────────────────────────────

const players = (ids: string[]): ModulePlayer[] => ids.map((id) => ({ id, connected: true }));
const ctx = (now: number, ps: ModulePlayer[]): ModuleContext => ({ now, players: ps, random: () => 0.999 });

function run(word: BluffWord, texts: Record<string, string>, judge: unknown, showOriginals = false) {
  const mod = createBluffModule([word]);
  const ps = players(Object.keys(texts));
  let now = T0;
  let state: BluffState = mod.init(ctx(now, ps), { questionCount: 1, scoring, excludeContentIds: [], options: { showOriginals } }).state;
  for (const [id, text] of Object.entries(texts)) {
    now += 1000;
    const r = mod.handleAction(state, { type: "define", text } as BluffAction, id, ctx(now, ps));
    if ("error" in r) throw new Error(r.error);
    state = r.state;
  }
  if (state.step === "check") {
    state = judge === "timeout" ? mod.onTimer(state, ctx(now, ps)).state : mod.resolveTask!(state, mod.pendingTask!(state)!.id, judge, ctx(now, ps))!.state;
  }
  return { mod, state, ps, now };
}

describe("Bluff-Lexikon v2 in the module", () => {
  it("Zipperlein: \"Wenn's weh tut\" is merged into the real answer (judge says correct)", () => {
    const { state } = run(ZIPPERLEIN, { a: "Wenn's weh tut", b: "ein kleiner Zwerg" }, {
      results: [
        { id: "s1", verdict: "correct", confidence: 0.8, reason: "Kern getroffen", polished: "Wenn es weh tut", sameIdea: true, group: 1 },
        { id: "s2", verdict: "bluff", confidence: 0.95, reason: "falsch", polished: "Ein kleiner Zwerg", sameIdea: true, group: 2 },
      ],
    });
    expect(state.knewIt).toEqual(["a"]);
    expect(state.options!.map((o) => o.text).sort()).toEqual(["Ein kleiner Zwerg", "Gicht; kleine Wehwehchen"]);
  });

  it("judge fails: the local check still finds an obvious correct answer and cleans the rest", () => {
    const { state } = run(SINGULTUS, { a: "schluckauf!!", b: "so ne art blasinstrument glaub ich", c: "komisch niesen lol" }, "timeout");
    expect(state.knewIt).toEqual(["a"]);
    expect(state.options!.map((o) => o.text).sort()).toEqual(["Art blasinstrument", "Komisch niesen", "Schluckauf"]);
  });

  it("no option, read-out text or public state ever contains the raw player text", () => {
    const raw = { a: "so ne art blasinstrument glaub ich lol", b: "wenn man zu viel gegessen hat und rülpst!!" };
    for (const judge of [
      {
        results: [
          { id: "s1", verdict: "bluff", confidence: 0.9, polished: "Eine Art Blasinstrument", sameIdea: true, group: 1 },
          { id: "s2", verdict: "bluff", confidence: 0.9, polished: "Wenn jemand nach zu viel Essen aufstößt", sameIdea: true, group: 2 },
        ],
      },
      "timeout",
    ]) {
      const { mod, state } = run(SINGULTUS, raw, judge);
      const texts = [
        ...state.options!.map((o) => o.text),
        ...mod.readAloud!(state)!.items.map((i) => i.text),
        JSON.stringify(mod.toPublicState(state, { role: "host" })),
        JSON.stringify(mod.toPublicState(state, { role: "player", playerId: "b" }).options),
      ];
      for (const t of texts) for (const r of Object.values(raw)) expect(t).not.toContain(r);
    }
  });

  it("the authors' originals appear only at the reveal and only with the host option", () => {
    for (const showOriginals of [false, true]) {
      const { mod, ps, now, state: s0 } = run(SINGULTUS, { a: "so ne art blasinstrument", b: "ein hut" }, "timeout", showOriginals);
      let state = mod.onTimer(s0, ctx(now, ps)).state; // present → vote
      for (const id of ["a", "b"]) {
        const r = mod.handleAction(state, { type: "vote", option: state.options!.findIndex((o) => o.correct) }, id, ctx(now + 1, ps));
        if ("error" in r) throw new Error(r.error);
        state = r.state;
      }
      const reveal = mod.toPublicState(state, { role: "host" }).reveal!;
      expect(reveal.lead).toBe("Ein Singultus ist:");
      expect(reveal.originals).toEqual(showOriginals ? { a: "so ne art blasinstrument", b: "ein hut" } : null);
    }
  });

  it("the phone and TV get the question with article", () => {
    const { mod, state } = run(ZIPPERLEIN, { a: "x" }, "timeout");
    expect(mod.toPublicState(state, { role: "host" }).question).toBe("Ein Zipperlein ist …?");
  });

  it("the judge task uses the strong model", () => {
    const mod = createBluffModule([SINGULTUS]);
    const ps = players(["a", "b"]);
    let s = mod.init(ctx(T0, ps), { questionCount: 1, scoring, excludeContentIds: [] }).state;
    for (const id of ["a", "b"]) {
      const r = mod.handleAction(s, { type: "define", text: "ein Hut " + id }, id, ctx(T0 + 1, ps));
      if ("error" in r) throw new Error(r.error);
      s = r.state;
    }
    expect(mod.pendingTask!(s)).toMatchObject({ model: "strong", timeoutMs: 6000 });
    expect(mod.pendingTask!(s)!.input.user).toContain("der Singultus");
  });
});
