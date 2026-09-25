import type { HostLine } from "@couch-clash/shared";

/** The clips of a line in playback order: the name clip ("Max …") first, then the line. */
export function lineAudioPaths(line: HostLine): string[] {
  return line.prefixAudioPath ? [line.prefixAudioPath, line.audioPath] : [line.audioPath];
}

/**
 * When each clip starts (seconds after the first) and how long it all
 * takes: back to back with `gapMs` between clips, at `rate`.
 */
export function sequenceSchedule(durationsSec: readonly number[], gapMs: number, rate = 1): { offsets: number[]; totalMs: number } {
  const offsets: number[] = [];
  let t = 0;
  durationsSec.forEach((d, i) => {
    offsets.push(t);
    t += d / rate + (i < durationsSec.length - 1 ? gapMs / 1000 : 0);
  });
  return { offsets, totalMs: Math.round(t * 1000) };
}
