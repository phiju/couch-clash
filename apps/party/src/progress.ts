import { GAME_MODULES, getModule, type ModuleRegistry } from "@couch-clash/games";
import type { RoomRecord } from "./room-logic";

export interface Progress {
  key: string;
  roundIndex: number;
  categoryId: string;
  index: number;
  total: number;
  step: string;
  contentId: string | null;
  revealed: boolean;
}

/** Where the running category stands (from the module's optional progress hook). */
export function progressOf(room: RoomRecord | null, registry: ModuleRegistry = GAME_MODULES): Progress | null {
  const game = room?.game;
  if (!room || room.phase !== "play" || !game || game.moduleState == null) return null;
  const round = game.rounds[game.roundIndex];
  const module = round ? getModule(round.categoryId, registry) : undefined;
  const p = module?.progress?.(game.moduleState);
  if (!p || !round) return null;
  return {
    index: p.index,
    total: p.total,
    step: p.step,
    contentId: p.contentId ?? null,
    revealed: !!p.revealed,
    roundIndex: game.roundIndex,
    categoryId: round.categoryId,
    key: `${game.roundIndex}:${p.index}`,
  };
}
