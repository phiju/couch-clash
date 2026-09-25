/** Pure helpers for reconnecting and rejoining (tested). */
import { CONNECTION_CONFIG, type PublicRoomState, type RoomNotice } from "@couch-clash/shared";

/** A wake-up (screen on, back online, tab visible again) needs a fresh socket? */
export function needsFreshSocket(input: { open: boolean; lastMessageAt: number; now: number }): boolean {
  return !input.open || input.now - input.lastMessageAt > CONNECTION_CONFIG.clientDeadAfterMs;
}

/** Phases with the corner chip – not in the lobby (big QR there) or the intro/finale animations. */
export function showJoinChip(phase: PublicRoomState["phase"] | undefined): boolean {
  return phase === "play" || phase === "scoreboard";
}

/** "Philip ist wieder da 👋" / "Neu dabei: Tina 🎉" */
export function noticeText(notice: RoomNotice): string {
  return notice.kind === "rejoined" ? `${notice.name} ist wieder da 👋` : `Neu dabei: ${notice.name} 🎉`;
}

/** Phases in which the host's late-join setting lets new players in (same rule as the server). */
export const LATE_JOIN_PHASES: readonly PublicRoomState["phase"][] = ["setup", "intro", "play", "scoreboard"];

/** "Wer bist du?": seats that can be claimed (no open connection), and whether joining as new is possible. */
export function claimOptions(room: Pick<PublicRoomState, "players" | "lateJoin" | "phase">) {
  return {
    free: room.players.filter((p) => !p.online),
    canJoinLate: room.lateJoin && LATE_JOIN_PHASES.includes(room.phase),
  };
}
