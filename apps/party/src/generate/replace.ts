/**
 * "Rauswerfen" in the admin page: write a replacement question in the same
 * category (same age rating, similar difficulty and tags, no duplicate),
 * check it with a second model call and store it in D1 as "neu generiert".
 * Never throws – failures end up in the generation log (shown in the admin).
 */
import type { ContentEntry } from "@couch-clash/shared";
import { GAME_MODULES, getModule, type ModuleRegistry } from "@couch-clash/games";
import type { StatsStore } from "../stats/store";
import { GENERATION_CONFIG } from "./config";
import { GENERATORS, similarEntries, type QuestionGenerator } from "./generators";
import type { JsonModel } from "./model";

export interface ReplaceDeps {
  store: StatsStore;
  model: JsonModel | null;
  now(): number;
  newId(): string;
  registry?: ModuleRegistry;
  generators?: Readonly<Record<string, QuestionGenerator>>;
  dailyLimit?: number;
  maxAttempts?: number;
}

export type ReplaceResult = { ok: true; id: string } | { ok: false; error: string };

const DAY_MS = 86_400_000;

export function startOfUtcDay(now: number) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function writePrompt(gen: QuestionGenerator, original: ContentEntry, similar: ContentEntry[]) {
  const system = [
    "Du schreibst Fragen für ein deutschsprachiges Partyspiel (Familie, Freunde, TV).",
    "Antworte ausschließlich mit einem JSON-Objekt in genau diesem Format:",
    gen.format,
    "Regeln:",
    "- Deutsch, korrekt, eindeutig, kurz (höchstens 200 Zeichen).",
    `- Passend für Spieler ab ${original.ageRating} Jahren.`,
    `- Schwierigkeit ${original.difficulty} von 3.`,
    "- Die Antwort muss sicher stimmen und überprüfbar sein.",
    ...gen.rules.map((r) => `- ${r}`),
  ].join("\n");
  const user = [
    `Schreibe eine neue Frage zu den Themen: ${original.tags.join(", ")}.`,
    `Sie ersetzt diese Frage (andere Frage, gleiche Art): ${original.text}`,
    similar.length > 0 ? `Diese Fragen gibt es schon – nichts davon wiederholen:\n${similar.map((e) => `- ${e.text}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, user };
}

function verifyPrompt(gen: QuestionGenerator, item: Record<string, unknown>) {
  return {
    system:
      'Du prüfst Fragen für ein Partyspiel auf Richtigkeit. Antworte nur mit JSON: {"ok": true|false, "reason": "kurze Begründung"}. ok ist nur true, wenn die markierte Antwort sicher richtig, die Frage eindeutig und der Fakt dauerhaft gültig ist.',
    user: gen.describe(item),
  };
}

async function logResult(deps: ReplaceDeps, categoryId: string, replacesId: string, ok: boolean, modelCalls: number, message: string) {
  try {
    await deps.store.logGeneration({
      created_at: deps.now(),
      category_id: categoryId,
      replaces_id: replacesId,
      ok: ok ? 1 : 0,
      model_calls: modelCalls,
      message,
    });
  } catch {
    console.warn("generate: log failed");
  }
}

export async function replaceQuestion(deps: ReplaceDeps, target: { id: string; categoryId: string }): Promise<ReplaceResult> {
  const { categoryId, id } = target;
  let modelCalls = 0;
  const fail = async (error: string): Promise<ReplaceResult> => {
    await logResult(deps, categoryId, id, false, modelCalls, error);
    return { ok: false, error };
  };

  const gen = (deps.generators ?? GENERATORS)[categoryId];
  const module = getModule(categoryId, deps.registry ?? GAME_MODULES);
  if (!gen || !module?.listContent || !module.parseContent) return fail("Für diese Kategorie gibt es keinen Generator.");
  if (!deps.model) return fail("OPENAI_API_KEY fehlt.");

  const limit = deps.dailyLimit ?? GENERATION_CONFIG.dailyLimit;
  let used: number;
  try {
    used = await deps.store.generationsSince(startOfUtcDay(deps.now()));
  } catch {
    return { ok: false, error: "Datenbank nicht erreichbar." };
  }
  if (used >= limit) return fail(`Tageslimit erreicht (${limit} pro Tag).`);

  let generated: Awaited<ReturnType<StatsStore["listGenerated"]>>;
  try {
    generated = await deps.store.listGenerated();
  } catch {
    return { ok: false, error: "Datenbank nicht erreichbar." };
  }
  const extra = generated.filter((r) => r.category_id === categoryId).flatMap((r) => {
    try {
      return [JSON.parse(r.payload) as unknown];
    } catch {
      return [];
    }
  });
  const all = module.listContent(extra);
  const original = all.find((e) => e.id === id);
  if (!original) return fail("Originalfrage nicht gefunden.");
  const known = new Set(all.map((e) => normalize(e.text)));
  const similar = similarEntries(original, all, GENERATION_CONFIG.maxSimilar);
  const prompt = writePrompt(gen, original, similar);

  let lastError = "unbekannter Fehler";
  const attempts = deps.maxAttempts ?? GENERATION_CONFIG.maxAttempts;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      modelCalls++;
      const json = await deps.model(prompt.system, prompt.user);
      if (!json || typeof json !== "object") throw new Error("keine JSON-Antwort");
      const newId = `${categoryId}-gen-${deps.newId().toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      const raw = gen.toItem(json as Record<string, unknown>, {
        id: newId,
        ageRating: original.ageRating,
        difficulty: original.difficulty,
        tags: original.tags,
      });
      const parsed = module.parseContent(raw);
      if (!parsed.ok) {
        lastError = `ungültig: ${parsed.error.slice(0, 160)}`;
        continue;
      }
      const item = parsed.value as Record<string, unknown>;
      // The category's own display text (question text, or article + word for the Bluff-Lexikon).
      const itemText = module.listContent([item]).find((e) => e.id === newId)?.text ?? String(item.text);
      if (known.has(normalize(itemText))) {
        lastError = "Duplikat einer vorhandenen Frage";
        continue;
      }
      const check = verifyPrompt(gen, item);
      modelCalls++;
      const verdict = (await deps.model(check.system, check.user)) as { ok?: unknown; reason?: unknown } | null;
      if (verdict?.ok !== true) {
        lastError = `Prüfung abgelehnt: ${typeof verdict?.reason === "string" ? verdict.reason.slice(0, 160) : "ohne Begründung"}`;
        continue;
      }
      await deps.store.insertGenerated({
        id: newId,
        category_id: categoryId,
        payload: JSON.stringify(item),
        replaces_id: id,
        status: "active",
        created_at: deps.now(),
      });
      await logResult(deps, categoryId, id, true, modelCalls, `Ersatz ${newId} nach ${attempt} Versuch(en)`);
      return { ok: true, id: newId };
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 160) : "Fehler";
    }
  }
  return fail(`Kein Ersatz nach ${attempts} Versuchen – ${lastError}`);
}
