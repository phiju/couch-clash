/**
 * Produces one spoken line: text model (4 s) → speech (8 s) → R2.
 * - Text fails → a pre-written template line is spoken instead.
 * - Speech fails → no line (there are no subtitles); nothing waits.
 * - Speech service refuses (quota, key, …) → the caller stops the voice for the room.
 * Logs only reasons and codes, never names or texts.
 */
import type { HostLine, HostLineKind } from "@couch-clash/shared";
import type { AvatarStore } from "../avatar/store";
import { VOICE_CONFIG } from "./config";
import { parseCommentReply, parseTextLine } from "./prompt";
import type { LinePrompt, SpeechProvider, SpeechStyle, TextProvider } from "./provider";
import { stripTags } from "./tags";

export interface VoiceServices {
  text: TextProvider | null;
  speech: SpeechProvider | null;
  store: AvatarStore | null;
}

export interface LineRequest {
  code: string;
  id: string;
  kind: HostLineKind;
  prompt: LinePrompt;
  /** Spoken when the text model is not allowed or fails. */
  fallback: string;
  /** False: text budget used up → template only. */
  useAi: boolean;
  style: SpeechStyle;
  /** TTS speed (Sprechtempo) and extra playback rate on the host. */
  speed: number;
  playbackRate: number;
  /** Absolute time the line must be ready by (commentary), or null. */
  deadline: number | null;
  now: () => number;
  /** Reserves characters from the room budget; false → budget used up. */
  reserveChars: (count: number) => Promise<boolean>;
  staleAfterMs?: number | null;
}

export interface ProducedLine {
  /** Null: nothing to play (speech failed, budget, too late). */
  line: HostLine | null;
  /** Name the model said the joke was about (commentary). */
  target: string | null;
  /** How the text was made – for counting in logs. */
  source: "ai" | "template";
  /** The voice must stop for this room. */
  voiceStatus?: "unavailable" | "budget";
  /** Error code for logs (never texts). */
  errorCode?: string;
}

class TimeoutError extends Error {}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (ms <= 0) throw new TimeoutError("no time left");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError("timeout"));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function reason(err: unknown): string {
  if (err instanceof TimeoutError) return "timeout";
  if (err instanceof Error && err.name === "VoiceProviderError") return (err as Error & { code?: string }).code || err.message;
  return "error";
}

export function voiceKey(code: string, id: string): string {
  return `rooms/${code}/voice/${id}.mp3`;
}

export function voicePath(code: string, id: string): string {
  return `/api/rooms/${encodeURIComponent(code)}/voice/${id}`;
}

export async function produceLine(services: VoiceServices, req: LineRequest): Promise<ProducedLine> {
  const budget = (limit: number) => (req.deadline === null ? limit : Math.min(limit, req.deadline - req.now()));

  // 1. Text (OpenAI) – or the template line.
  let text = req.fallback;
  let target: string | null = null;
  let source: ProducedLine["source"] = "template";
  if (req.useAi && services.text) {
    try {
      const raw = await withTimeout(budget(VOICE_CONFIG.textTimeoutMs), (signal) =>
        services.text!.generateLine(req.prompt, { signal }),
      );
      const parsed = req.prompt.json ? parseCommentReply(raw) : (() => {
        const line = parseTextLine(raw);
        return line ? { line, target: null } : null;
      })();
      if (parsed) {
        text = parsed.line;
        target = parsed.target;
        source = "ai";
      } else {
        console.warn(`voice ${req.kind}: template line (unusable reply)`);
      }
    } catch (err) {
      console.warn(`voice ${req.kind}: template line (text ${reason(err)})`);
    }
  }

  // 2. Voice – without it there is nothing to show.
  if (!services.speech || !services.store) return { line: null, target, source };
  const spoken = services.speech.prepare(text, req.style);
  if (!spoken) return { line: null, target, source };
  if (!(await req.reserveChars(spoken.length))) {
    return { line: null, target, source, voiceStatus: "budget" };
  }
  try {
    const clip = await withTimeout(budget(VOICE_CONFIG.speechTimeoutMs), (signal) =>
      services.speech!.speak(spoken, { style: req.style, speed: req.speed, signal }),
    );
    await services.store.put(voiceKey(req.code, req.id), clip.bytes, clip.mimeType);
    return {
      line: {
        id: req.id,
        kind: req.kind,
        text: stripTags(text),
        audioPath: voicePath(req.code, req.id),
        playbackRate: req.playbackRate,
        staleAfterMs: req.staleAfterMs ?? null,
      },
      target,
      source,
    };
  } catch (err) {
    const code = reason(err);
    const unavailable = err instanceof Error && (err as Error & { reason?: string }).reason === "unavailable";
    console.warn(`voice ${req.kind}: no speech (${code})`);
    return { line: null, target, source, voiceStatus: unavailable ? "unavailable" : undefined, errorCode: code };
  }
}
