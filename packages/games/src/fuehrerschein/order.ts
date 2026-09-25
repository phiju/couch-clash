/**
 * Who drives in which order at the reveal of a scene – read from the
 * question's correct answer, never computed from traffic rules:
 * - "Blau, Rot, Grün" → that order,
 * - "Wer darf zuerst …?" → the named one first, the others after,
 * - "Wer muss warten?" → the named one(s) last.
 * Pedestrians are actors "ped:<arm>".
 */
import type { SceneMedia, VehicleColor } from "@couch-clash/shared";

const COLOR_WORDS: Record<VehicleColor, RegExp> = {
  rot: /\brot(e[nrs]?)?\b/i,
  blau: /\bblau(e[nrs]?)?\b/i,
  grün: /\bgrün(e[nrs]?)?\b/i,
  gelb: /\bgelb(e[nrs]?)?\b/i,
};

/** Actors named in an answer, in the order they are named. Null if the answer names nobody. */
export function namedActors(scene: SceneMedia, answer: string): string[] | null {
  const hits: { id: string; at: number }[] = [];
  for (const v of scene.vehicles) {
    const m = COLOR_WORDS[v.color].exec(answer);
    if (m) hits.push({ id: v.id, at: m.index });
  }
  const ped = /fußgänger/i.exec(answer);
  if (ped) for (const p of scene.pedestrians ?? []) hits.push({ id: `ped:${p.at}`, at: ped.index });
  if (hits.length === 0) return null;
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

export function allActors(scene: SceneMedia): string[] {
  return [...(scene.pedestrians ?? []).map((p) => `ped:${p.at}`), ...scene.vehicles.map((v) => v.id)];
}

/** Null if the answer does not name the scene's actors (content error – the test catches it). */
export function driveOrder(scene: SceneMedia, questionText: string, correctAnswer: string): string[] | null {
  const named = namedActors(scene, correctAnswer);
  if (!named) return null;
  const rest = allActors(scene).filter((id) => !named.includes(id));
  // Pedestrians first among the others – they walk while cars wait.
  if (/warten/i.test(questionText)) return [...rest, ...named];
  return [...named, ...rest];
}
