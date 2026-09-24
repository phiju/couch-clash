import type { PublicPlayer } from "@couch-clash/shared";

/** Last seen ready version per player id (null = no photo yet). */
export type ReadySnapshot = ReadonlyMap<string, number | null>;

/**
 * Players whose photo avatar just became ready (or got a new image) since the
 * last snapshot. Players seen for the first time never count – a reloaded
 * host screen must not celebrate everyone again.
 */
export function newlyReadyPhotos(
  previous: ReadySnapshot,
  players: readonly PublicPlayer[],
): { ready: string[]; snapshot: Map<string, number | null> } {
  const snapshot = new Map<string, number | null>();
  const ready: string[] = [];
  for (const p of players) {
    const version = p.avatar.photo?.readyVersion ?? null;
    snapshot.set(p.id, version);
    if (previous.has(p.id) && version !== null && version !== previous.get(p.id)) ready.push(p.id);
  }
  return { ready, snapshot };
}
