/**
 * The room's side of the Survival-Finale's show (pure, tested): the moderator's
 * cues move the finale's timer forward, and the last two get their trophy
 * figure in the background (FINAL_TWO) so it is ready at the ceremony.
 */
import { GAME_MODULES, getModule, survivalCueAt, type ModuleRegistry, type SurvivalCue, type SurvivalState } from "@couch-clash/games";
import type { RoomRecord } from "./room-logic";

/** The running Survival-Finale's state, or null. */
export function survivalOf(room: RoomRecord | null, registry: ModuleRegistry = GAME_MODULES): SurvivalState | null {
  const game = room?.phase === "play" ? room.game : null;
  const round = game?.rounds[game.roundIndex];
  if (!game || game.moduleState == null || !round) return null;
  return getModule(round.categoryId, registry)?.meta.finale ? (game.moduleState as SurvivalState) : null;
}

/**
 * The moderator's line is over: the room's timer moves up to the moment the
 * finale may go on (the ride starts, the ceremony follows). Null when nothing
 * changes – the cue doesn't fit the step, or the timer is sooner anyway.
 */
export function applySurvivalCue(room: RoomRecord, cue: SurvivalCue, now: number, registry?: ModuleRegistry): RoomRecord | null {
  const s = survivalOf(room, registry);
  if (!s || room.phaseEndsAt === null) return null;
  const at = survivalCueAt(s, cue, now);
  if (at === null || at >= room.phaseEndsAt) return null;
  return { ...room, phaseEndsAt: at };
}

/** Players who just became one of the last two (FINAL_TWO since `prev`) – they get the trophy figure. */
export function trophyCandidates(prev: RoomRecord | null, next: RoomRecord, registry?: ModuleRegistry): string[] {
  const s = survivalOf(next, registry);
  if (!s || s.solo) return [];
  // Between two finales the room is never in "play" – no survival state before means a new finale.
  const lastSeq = survivalOf(prev, registry)?.events.at(-1)?.seq ?? 0;
  const ids = s.events.filter((e) => e.type === "FINAL_TWO" && e.seq > lastSeq).flatMap((e) => e.playerIds ?? []);
  return [...new Set(ids)];
}
