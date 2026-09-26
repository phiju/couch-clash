import { DOUBLE_CONFIG, potAfterWin, type DoubleExtra, type DoublePlayerView, type KnowledgePublicState } from "@couch-clash/games/meta";
import type { PhotoExpression } from "@couch-clash/shared";

export type DoubleState = KnowledgePublicState<DoubleExtra>;

/** "1.500" */
export const fmt = (n: number) => n.toLocaleString("de-DE");

const LEVEL_NAMES = ["leicht", "mittel", "knifflig", "schwer", "sehr schwer"] as const;

/** "Stufe 4 · schwer" */
export function levelLabel(level: number): string {
  return `Stufe ${level} · ${LEVEL_NAMES[Math.min(LEVEL_NAMES.length, Math.max(1, level)) - 1]}`;
}

/** From level 4 on: a warning before the choice. */
export function levelWarning(level: number, kids: boolean): string | null {
  if (level < DOUBLE_CONFIG.warnLevel) return null;
  return kids ? "Achtung – jetzt wird's richtig knifflig!" : "Jetzt wird's richtig fies …";
}

/** What is at stake: "700 → 1.500". */
export function stakeText(pot: number, bonus: number): string {
  return `${fmt(pot)} → ${fmt(potAfterWin(pot, bonus))}`;
}

/**
 * Where a player stands right now (TV and phones):
 *   deciding / decided – still in, choosing (never what)
 *   cash / bet – uncovered at the showdown
 *   playing – bet, the question runs
 *   won / busted – this question's result
 *   out – cashed out or busted earlier (greyed out), watch – joined later
 */
export type PotMoment = "deciding" | "decided" | "cash" | "bet" | "playing" | "won" | "busted" | "out" | "watch";

export function potMoment(state: DoubleState, id: string): PotMoment {
  const p = state.extra.players[id];
  if (!p) return "watch";
  const played = !!state.reveal && id in state.reveal.results;
  switch (state.step) {
    case "decide":
      if (p.status !== "active") return "out";
      return state.actedPlayerIds.includes(id) ? "decided" : "deciding";
    case "showdown": {
      const choice = state.extra.decisions?.[id];
      return choice ?? "out";
    }
    case "question":
      return p.status === "active" ? "playing" : "out";
    case "reveal":
    case "leaderboard":
      if (!played) return "out";
      return p.status === "busted" ? "busted" : "won";
    default:
      return p.status === "active" ? "playing" : "out";
  }
}

export interface PotReaction {
  expression: PhotoExpression;
  /** Out of the round: greyed out. */
  dimmed: boolean;
  /** Still in: highlighted. */
  highlight: boolean;
}

/** The avatar's face and look for this moment. */
export function potReaction(moment: PotMoment, player: DoublePlayerView | undefined): PotReaction {
  switch (moment) {
    case "cash":
    case "won":
      return { expression: "jubelnd", dimmed: false, highlight: moment === "won" && !player?.auto };
    case "busted":
      return { expression: "enttaeuscht", dimmed: false, highlight: false };
    case "bet":
      return { expression: "geschockt", dimmed: false, highlight: true };
    case "deciding":
    case "decided":
    case "playing":
      return { expression: "neutral", dimmed: false, highlight: true };
    case "out":
      return { expression: player?.status === "busted" ? "enttaeuscht" : "neutral", dimmed: true, highlight: false };
    default:
      return { expression: "neutral", dimmed: true, highlight: false };
  }
}

/** The label under a player who is out: "kassiert: 700" / "pleite". */
export function outLabel(player: DoublePlayerView | undefined): string {
  if (!player) return "schaut zu";
  if (player.status === "busted") return "pleite";
  if (player.status === "cashed_out") return `kassiert: ${fmt(player.banked ?? 0)}`;
  return `Topf: ${fmt(player.pot)}`;
}

/** Phone: this player only watches right now (no choice, no answers). */
export function isSidelined(state: DoubleState, meId: string): boolean {
  const p = state.extra.players[meId];
  if (!p) return true;
  if (p.status === "active") return false;
  // Just cashed out / just out: the moment itself is still theirs.
  if (state.step === "showdown" && state.extra.decisions?.[meId] === "cash") return false;
  if (state.step === "reveal" && !!state.reveal && meId in state.reveal.results) return false;
  return true;
}

/** Phone: what the sidelined player sees. */
export function sidelinedText(player: DoublePlayerView | undefined): { emoji: string; title: string; text: string } {
  if (!player) return { emoji: "👀", title: "Du schaust zu", text: "Diese Runde läuft schon – in der nächsten bist du dabei!" };
  if (player.status === "busted") {
    return { emoji: "💥", title: "Dein Topf ist geplatzt", text: "Du bist raus – schau zu, wer sich noch traut." };
  }
  return {
    emoji: player.auto ? "🏁" : "💰",
    title: `Du hast ${fmt(player.banked ?? 0)} Punkte kassiert`,
    text: player.auto ? "Bis zum Schluss durchgezogen – stark!" : "Sicher ist sicher. Jetzt heißt es: zuschauen und mitzittern.",
  };
}

/** The level meter: 🔥 per level (dim above the current level). */
export function flames(level: number, max: number = DOUBLE_CONFIG.maxLevel): boolean[] {
  return Array.from({ length: max }, (_, i) => i < level);
}
