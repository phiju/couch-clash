import { describe, expect, it } from "vitest";
import { bluffModule } from "../src/bluff/module";
import golden from "./fixtures/bluff-golden.json";
import { recordBluffRun } from "./fixtures/bluff-run";

/**
 * Fields the engine added to the public state since the recording. The
 * placeholder is the text the phone showed before (then hard-coded there).
 */
const ADDED = new Set(["placeholder"]);
const strip = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(strip)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).flatMap(([k, v]) => (ADDED.has(k) ? [] : [[k, strip(v)]])))
      : value;

describe("Bluff-Lexikon regression (golden master from before the engine refactor)", () => {
  const runs = strip(
    JSON.parse(JSON.stringify({ family: recordBluffRun(bluffModule, "family", 7), party: recordBluffRun(bluffModule, "party", 11) })),
  ) as Record<"family" | "party", unknown[]>;

  it.each(["family", "party"] as const)("%s: same words, texts, options, prompts, scoring and stats", (mode) => {
    expect(runs[mode]).toEqual((golden as Record<string, unknown>)[mode]);
  });

  it("the placeholder is the one the phone showed before", () => {
    expect(bluffModule.toPublicState(bluffModule.init({ now: 0, players: [], random: () => 0 }, { questionCount: 1, scoring: bluffModule.meta.scoring, excludeContentIds: [] }).state, { role: "host" }).placeholder).toBe(
      "… z. B. ein Werkzeug, das …",
    );
  });
});
