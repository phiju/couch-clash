/**
 * Admin: the host's voice library. GET shows the ElevenLabs usage and how
 * many library lines are voiced; POST voices the next batch of missing
 * lines ("Moderator-Sprüche vertonen" – the admin page repeats it until
 * nothing is left). Never runs at game start.
 */
import { SNARK_LINES_DE, type SnarkLines } from "@couch-clash/content";
import type { AdminVoiceResponse, AdminVoiceRunResponse } from "@couch-clash/shared";
import { VOICE_CONFIG } from "./config";
import { voiceCacheKey } from "./cache";
import { accountLow } from "./rules";
import { cachedClip, type VoiceServices } from "./service";
import { allSnarkLines } from "./snark";

export const SNARK_BATCH = { size: 12, parallel: 3 } as const;

async function missingLines(services: VoiceServices, lines: readonly string[]): Promise<string[]> {
  const { store, speech } = services;
  if (!store) return [...lines];
  const checks = await Promise.all(
    lines.map(async (line) => {
      const spoken = speech ? speech.prepare(line, "fast") : line;
      return (await store.has(await voiceCacheKey("snark", spoken, "fast", VOICE_CONFIG.cachedSpeed))) ? null : line;
    }),
  );
  return checks.filter((l): l is string => l !== null);
}

export async function voiceStatus(services: VoiceServices, library: SnarkLines = SNARK_LINES_DE): Promise<AdminVoiceResponse> {
  const lines = allSnarkLines(library);
  const [account, missing] = await Promise.all([services.usage?.() ?? null, missingLines(services, lines)]);
  return { account, snark: { total: lines.length, cached: lines.length - missing.length } };
}

/** Voices the next batch of library lines that are not cached yet. */
export async function voiceSnarkBatch(services: VoiceServices, library: SnarkLines = SNARK_LINES_DE): Promise<AdminVoiceRunResponse> {
  const lines = allSnarkLines(library);
  const account = (await services.usage?.()) ?? null;
  if (!services.speech || !services.store) {
    return { ok: false, error: "Keine Stimme eingerichtet (ELEVENLABS_API_KEY / R2).", account, snark: { total: lines.length, cached: 0 }, generated: 0, failed: 0 };
  }
  const missing = await missingLines(services, lines);
  if (missing.length > 0 && accountLow(account)) {
    return {
      ok: false,
      error: "Weniger als 10 % der ElevenLabs-Credits übrig – erst nächsten Monat wieder.",
      account,
      snark: { total: lines.length, cached: lines.length - missing.length },
      generated: 0,
      failed: 0,
    };
  }
  const batch = missing.slice(0, SNARK_BATCH.size);
  let generated = 0;
  let failed = 0;
  let stop: string | null = null;
  for (let i = 0; i < batch.length && !stop; i += SNARK_BATCH.parallel) {
    const results = await Promise.all(
      batch.slice(i, i + SNARK_BATCH.parallel).map((text) =>
        cachedClip(services, { kind: "snark", text, style: "fast", speed: VOICE_CONFIG.cachedSpeed, allowNew: true, reserveCredits: async () => true }),
      ),
    );
    for (const r of results) {
      if (r.path) generated++;
      else failed++;
      if (r.voiceStatus === "unavailable") stop = r.errorCode ?? "unavailable";
    }
  }
  const cached = lines.length - missing.length + generated;
  return {
    ok: !stop,
    ...(stop ? { error: `ElevenLabs hat abgelehnt (${stop}).` } : {}),
    account,
    snark: { total: lines.length, cached },
    generated,
    failed,
  };
}
