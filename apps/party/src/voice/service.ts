/**
 * Produces one line: text model (4 s) → speech (8 s) → R2. Any error or
 * timeout falls back to a template line (subtitle only) – nothing waits.
 * Logs only reasons, never names or texts.
 */
import type { HostLine, HostLineKind } from "@couch-clash/shared";
import type { AvatarStore } from "../avatar/store";
import { VOICE_CONFIG } from "./config";
import { parseCommentReply, parseTextLine } from "./prompt";
import type { LinePrompt, SpeechProvider, TextProvider } from "./provider";

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
  /** Used when AI is not allowed or fails. */
  fallback: string;
  /** False: budget used up → template only. */
  useAi: boolean;
  /** Absolute time the line must be ready by (commentary), or null. */
  deadline: number | null;
  now: () => number;
  staleAfterMs?: number | null;
}

export interface ProducedLine {
  line: HostLine;
  /** Name the model said the joke was about (commentary). */
  target: string | null;
  /** How the line was made – for counting in logs. */
  source: "ai" | "ai-text-only" | "template";
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
  if (err instanceof Error && err.name === "VoiceProviderError") return err.message;
  return "error";
}

export function voiceKey(code: string, id: string): string {
  return `rooms/${code}/voice/${id}.mp3`;
}

export function voicePath(code: string, id: string): string {
  return `/api/rooms/${encodeURIComponent(code)}/voice/${id}`;
}

export async function produceLine(services: VoiceServices, req: LineRequest): Promise<ProducedLine> {
  const budget = (limit: number) =>
    req.deadline === null ? limit : Math.min(limit, req.deadline - req.now());
  const make = (text: string, audioPath: string | null): HostLine => ({
    id: req.id,
    kind: req.kind,
    text,
    audioPath,
    staleAfterMs: req.staleAfterMs ?? null,
  });
  const template = (why: string): ProducedLine => {
    if (why) console.warn(`voice ${req.kind}: template line (${why})`);
    return { line: make(req.fallback, null), target: null, source: "template" };
  };

  if (!req.useAi) return template("");
  if (!services.text) return template("no text provider");

  let text: string;
  let target: string | null = null;
  try {
    const raw = await withTimeout(budget(VOICE_CONFIG.textTimeoutMs), (signal) =>
      services.text!.generateLine(req.prompt, { signal }),
    );
    if (req.prompt.json) {
      const parsed = parseCommentReply(raw);
      if (!parsed) return template("unusable reply");
      text = parsed.line;
      target = parsed.target;
    } else {
      const parsed = parseTextLine(raw);
      if (!parsed) return template("unusable reply");
      text = parsed;
    }
  } catch (err) {
    return template(`text ${reason(err)}`);
  }

  if (!services.speech || !services.store) return { line: make(text, null), target, source: "ai-text-only" };
  try {
    const clip = await withTimeout(budget(VOICE_CONFIG.speechTimeoutMs), (signal) =>
      services.speech!.speak(text, { signal }),
    );
    await services.store.put(voiceKey(req.code, req.id), clip.bytes, clip.mimeType);
    return { line: make(text, voicePath(req.code, req.id)), target, source: "ai" };
  } catch (err) {
    // The written line is still good – show it as a subtitle.
    console.warn(`voice ${req.kind}: no speech (${reason(err)})`);
    return { line: make(text, null), target, source: "ai-text-only" };
  }
}
