/**
 * Reads public/audio/audio.json. The format is parsed defensively: an
 * object keyed by id, `{ files: … }`, or an array of entries with
 * id/name/file. Loop points are in seconds; without them the loop skips
 * the 0.5 s lead-in and tail the files contain.
 */
import { EFFECT_IDS, MUSIC_IDS, type AudioId } from "./scenes";

export interface AudioEntry {
  id: AudioId;
  url: string;
  loop: boolean;
  loopStart?: number;
  loopEnd?: number;
  /** Per-track level from audio.json (default 1). */
  gain: number;
}

export const AUDIO_BASE = "/audio/";
const DEFAULT_LEAD_IN = 0.5;
const ALL_IDS: readonly AudioId[] = [...MUSIC_IDS, ...EFFECT_IDS];

type RawEntry = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const baseName = (file: string) => file.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "");

function entriesOf(raw: unknown): [string | undefined, RawEntry][] {
  if (Array.isArray(raw)) return raw.filter((e) => e && typeof e === "object").map((e) => [undefined, e as RawEntry]);
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  for (const k of ["files", "tracks", "audio", "sounds"]) if (obj[k]) return entriesOf(obj[k]);
  return Object.entries(obj)
    .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v))
    .map(([k, v]) => [k, v as RawEntry]);
}

/** Missing entries fall back to "<id>.mp3" so every sound has a URL. */
export function parseAudioManifest(raw: unknown): Record<AudioId, AudioEntry> {
  const found = new Map<AudioId, AudioEntry>();
  for (const [key, e] of entriesOf(raw)) {
    const file = str(e.file) ?? str(e.src) ?? str(e.url) ?? str(e.path);
    const idCandidate = str(e.id) ?? str(e.name) ?? key ?? (file ? baseName(file) : undefined);
    const id = [idCandidate, file ? baseName(file) : undefined].find((c): c is AudioId =>
      ALL_IDS.includes(c as AudioId),
    );
    if (!id) continue;
    const loopStart = num(e.loopStart) ?? num(e.loop_start);
    const loopEnd = num(e.loopEnd) ?? num(e.loop_end);
    const role = str(e.role) ?? str(e.type) ?? "";
    found.set(id, {
      id,
      url: !file ? `${AUDIO_BASE}${id}.mp3` : /^(\/|https?:)/.test(file) ? file : AUDIO_BASE + file.split("/").pop(),
      loop: e.loop === true || /loop|music|background/i.test(role) || (MUSIC_IDS as readonly string[]).includes(id),
      loopStart,
      loopEnd,
      gain: Math.min(4, Math.max(0, num(e.gain) ?? 1)),
    });
  }
  const out = {} as Record<AudioId, AudioEntry>;
  for (const id of ALL_IDS) {
    out[id] = found.get(id) ?? {
      id,
      url: `${AUDIO_BASE}${id}.mp3`,
      loop: (MUSIC_IDS as readonly string[]).includes(id),
      gain: 1,
    };
  }
  return out;
}

/** Loop points within the buffer (seconds), never the whole file. */
export function loopPoints(entry: AudioEntry, duration: number): { start: number; end: number } {
  const start = entry.loopStart ?? Math.min(DEFAULT_LEAD_IN, duration / 4);
  const end = entry.loopEnd ?? Math.max(start + 0.1, duration - DEFAULT_LEAD_IN);
  return { start: Math.max(0, start), end: Math.min(duration, Math.max(start + 0.05, end)) };
}
