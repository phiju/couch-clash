import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../src/components/host");

describe("lobby settings column", () => {
  it("never scrolls sideways: the cards can't grow wider than the column", () => {
    const panel = readFileSync(join(SRC, "settings-panel.tsx"), "utf8");
    // A plain `grid` column grows to its longest content (e.g. a long option text) – every card overflowed.
    expect(panel).toMatch(/grid-cols-\[minmax\(0,1fr\)\]/);
    const lobby = readFileSync(join(SRC, "lobby.tsx"), "utf8");
    expect(lobby).toMatch(/overflow-x-hidden overflow-y-auto/);
  });
});
