/**
 * Pure text helpers: cleaning a typed answer, the first-letter check
 * (articles ignored, umlauts count as their vowel) and the local duplicate
 * key (spelling variants like „Muenchen“ = „München“).
 */
import { levenshtein, normalizeAnswer } from "../pixelpanik/match";
import { SLF_CONFIG } from "./meta";

/** Leading articles that never count for the letter („der Rhein“ → R). */
const ARTICLE = /^(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/iu;

/** Single line, no control characters, no emojis, at most maxAnswerLength characters. */
export function cleanAnswer(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SLF_CONFIG.maxAnswerLength)
    .trim();
}

/** The first letter as A–Z (Ä → A, É → E), or null. */
function firstLetter(text: string): string | null {
  const m = text.match(/\p{L}/u);
  if (!m) return null;
  const base = m[0].normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  return /^[A-Z]$/.test(base) ? base : null;
}

/** Letters in the text (an answer needs at least two). */
function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/**
 * ok: starts with the letter (after an article) · maybe: only the article
 * starts with it („Die Hard“ for D – the AI decides whether it is part of a
 * title) · no: wrong letter or not a word.
 */
export type LetterCheck = "ok" | "maybe" | "no";

export function checkLetter(answer: string, letter: string): LetterCheck {
  const text = answer.trim();
  if (letterCount(text) < 2) return "no";
  const want = letter.toUpperCase();
  const stripped = text.replace(ARTICLE, "");
  if (stripped !== text && letterCount(stripped) >= 2) {
    if (firstLetter(stripped) === want) return "ok";
    return firstLetter(text) === want ? "maybe" : "no";
  }
  return firstLetter(text) === want ? "ok" : "no";
}

/** Local duplicate key: lower case, umlauts spelled out, articles, spaces and punctuation removed. */
export function duplicateKey(answer: string): string {
  return normalizeAnswer(answer.replace(ARTICLE, ""));
}

/** Two answers mean the same thing locally: same key, or a small typo apart (long words only). */
export function sameAnswer(a: string, b: string): boolean {
  const x = duplicateKey(a);
  const y = duplicateKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = Math.min(x.length, y.length);
  if (shorter < 6) return false;
  return levenshtein(x, y, 1) <= 1;
}

/** Names for what the host reads out: one line, no brackets or quotes that could confuse the voice. */
export function spokenName(name: string | undefined): string {
  const n = (name ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Extended_Pictographic}]/gu, "")
    .replace(/[<>[\]{}"„“]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
    .trim();
  return n || "Jemand";
}

/** A player's answer as the host says it (no quotes or brackets for the voice). */
export function spokenAnswer(text: string): string {
  return text.replace(/[<>[\]{}"„“]/g, "").replace(/\s+/g, " ").trim();
}
