/**
 * Admin API for "/admin/fragen". Every route needs `Authorization: Bearer
 * <ADMIN_TOKEN>` (Worker secret). Returns aggregated numbers and the question
 * content – never player names or answers.
 */
import {
  COST_CONFIG,
  MONTH_RE,
  QUESTION_STATUSES,
  type AdminCostsResponse,
  modesFor,
  type AdminQuestion,
  type AdminQuestionsResponse,
  type QuestionStatus,
} from "@couch-clash/shared";
import { GAME_MODULES, getModule, type ModuleRegistry } from "@couch-clash/games";
import { z } from "zod";
import type { CostStore } from "../costs/store";
import { GENERATION_CONFIG } from "../generate/config";
import { replaceQuestion, startOfUtcDay, type ReplaceDeps } from "../generate/replace";
import { json } from "../http";
import { invalidateContentFilter } from "../stats/content-filter";
import type { GeneratedRow, StatsRow, StatsStore } from "../stats/store";
import { handleAdminSongs } from "../songs/admin";
import type { SongOverrideStore } from "../songs/store";
import { voiceSnarkBatch, voiceStatus } from "../voice/admin";
import type { VoiceServices } from "../voice/service";

export interface AdminDeps {
  adminToken: string | undefined;
  store: StatsStore | null;
  /** Runs replacement jobs in the background (ctx.waitUntil). */
  background(promise: Promise<unknown>): void;
  replaceDeps(store: StatsStore): ReplaceDeps;
  now(): number;
  registry?: ModuleRegistry;
  /** The host's voice (library task, ElevenLabs usage); absent → not set up. */
  voice?: () => VoiceServices;
  /** Cost overview (D1); absent → not set up. */
  costs?: CostStore | null;
  /** Musik-Quiz corrections (D1); absent → not set up. */
  songs?: SongOverrideStore | null;
}

/** How far back the cost page looks. */
const COST_HISTORY_DAYS = 400;

const FixedCostSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    amount: z.number().finite().min(0).max(100_000),
    currency: z.enum(["EUR", "USD"]),
    since: z.string().regex(MONTH_RE),
    until: z.string().regex(MONTH_RE).nullable(),
    note: z.string().trim().max(200).nullable(),
  })
  .refine((c) => c.until === null || c.until >= c.since, { message: "„bis“ liegt vor „ab“." });

async function handleCosts(request: Request, url: URL, deps: AdminDeps): Promise<Response> {
  const store = deps.costs;
  if (!store) return json({ error: "Datenbank (STATS) ist nicht eingerichtet." }, 503);
  try {
    if (url.pathname === "/api/admin/costs" && request.method === "GET") {
      const since = new Date(deps.now() - COST_HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
      const usageFn = deps.voice?.().usage;
      const [usage, fixed, elevenlabs] = await Promise.all([
        store.usageSince(since),
        store.listFixed(),
        usageFn ? usageFn().catch(() => null) : Promise.resolve(null),
      ]);
      return json({ usage, fixed, elevenlabs, usdToEur: COST_CONFIG.usdToEur } satisfies AdminCostsResponse);
    }
    if (url.pathname === "/api/admin/costs/fixed" && request.method === "POST") {
      const parsed = FixedCostSchema.safeParse(await readJson(request));
      if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." }, 400);
      await store.addFixed(parsed.data);
      return json({ ok: true });
    }
    const one = url.pathname.match(/^\/api\/admin\/costs\/fixed\/(\d+)$/);
    if (one && request.method === "PUT") {
      const parsed = FixedCostSchema.safeParse(await readJson(request));
      if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." }, 400);
      return (await store.updateFixed(Number(one[1]), parsed.data)) ? json({ ok: true }) : json({ error: "Nicht gefunden." }, 404);
    }
    if (one && request.method === "DELETE") {
      return (await store.deleteFixed(Number(one[1]))) ? json({ ok: true }) : json({ error: "Nicht gefunden." }, 404);
    }
  } catch (err) {
    console.warn(`admin costs: request failed (${err instanceof Error ? err.message.slice(0, 80) : "error"})`);
    return json({ error: "Datenbank nicht erreichbar." }, 503);
  }
  return json({ error: "Not found" }, 404);
}

const MAX_BULK = 200;

const StatusRequestSchema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1).max(100), categoryId: z.string().min(1).max(50) }))
    .min(1)
    .max(MAX_BULK),
  status: z.enum(QUESTION_STATUSES),
});

/** Constant-time comparison (the token length is not secret). */
function sameToken(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAuthorized(request: Request, token: string | undefined) {
  const header = request.headers.get("Authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return !!token && !!given && sameToken(given, token);
}

const ratio = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);

export async function listAdminQuestions(store: StatsStore, now: number, registry: ModuleRegistry = GAME_MODULES) {
  const [stats, generated, log, today] = await Promise.all([
    store.listStats(),
    store.listGenerated(),
    store.recentGenerationLog(30),
    store.generationsSince(startOfUtcDay(now)),
  ]);
  const statsById = new Map<string, StatsRow>(stats.map((r) => [r.question_id, r]));
  const generatedById = new Map<string, GeneratedRow>(generated.map((r) => [r.id, r]));
  const questions: AdminQuestion[] = [];
  for (const [categoryId, module] of Object.entries(registry)) {
    if (!module.listContent) continue;
    const extra = generated.filter((r) => r.category_id === categoryId).flatMap((r) => {
      try {
        return [JSON.parse(r.payload) as unknown];
      } catch {
        return [];
      }
    });
    for (const entry of module.listContent(extra)) {
      const s = statsById.get(entry.id);
      const gen = generatedById.get(entry.id);
      const answers = s?.answers ?? 0;
      questions.push({
        id: entry.id,
        categoryId,
        text: entry.text,
        answer: entry.answer,
        source: entry.source ?? null,
        difficulty: entry.difficulty as 1 | 2 | 3,
        ageRating: entry.ageRating,
        tags: entry.tags,
        plays: s?.plays ?? 0,
        answers,
        correctRate: ratio(s?.correct ?? 0, answers),
        avgErrorPct: entry.errorMetric ? ratio(s?.sum_error_pct ?? 0, answers) : null,
        avgResponseMs: answers > 0 ? Math.round((s?.sum_response_ms ?? 0) / answers) : null,
        thumbsUp: s?.thumbs_up ?? 0,
        thumbsDown: s?.thumbs_down ?? 0,
        reports: s?.reports ?? 0,
        status: (s?.status ?? "active") as QuestionStatus,
        lastPlayedAt: s?.last_played_at ?? null,
        generated: !!gen,
        replacesId: gen?.replaces_id ?? null,
        createdAt: gen?.created_at ?? null,
        payload: gen ? entry.payload : null,
        modes: modesFor(entry, true, module.meta),
        party: entry.adult === true,
      });
    }
  }
  const body: AdminQuestionsResponse = {
    questions,
    generationLog: log.map((l) => ({
      createdAt: l.created_at,
      categoryId: l.category_id,
      replacesId: l.replaces_id,
      ok: l.ok === 1,
      message: l.message,
    })),
    generationsToday: today,
    dailyGenerationLimit: GENERATION_CONFIG.dailyLimit,
  };
  return body;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Handles /api/admin/*; null for other paths. */
export async function handleAdmin(request: Request, url: URL, deps: AdminDeps): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/admin/")) return null;
  if (!deps.adminToken) return json({ error: "ADMIN_TOKEN ist nicht gesetzt." }, 503);
  if (!isAuthorized(request, deps.adminToken)) return json({ error: "Nicht berechtigt." }, 401);

  if (url.pathname.startsWith("/api/admin/costs")) return handleCosts(request, url, deps);
  const songs = await handleAdminSongs(request, url, deps.songs ?? null, deps.now());
  if (songs) return songs;

  // The voice needs no database.
  if (url.pathname === "/api/admin/voice" || url.pathname === "/api/admin/voice/snark") {
    const services = deps.voice?.() ?? { text: null, speech: null, store: null, usage: null };
    if (request.method === "GET" && url.pathname === "/api/admin/voice") return json(await voiceStatus(services));
    if (request.method === "POST" && url.pathname === "/api/admin/voice/snark") return json(await voiceSnarkBatch(services));
    return json({ error: "Not found" }, 404);
  }

  const store = deps.store;
  if (!store) return json({ error: "Datenbank (STATS) ist nicht eingerichtet." }, 503);
  const registry: ModuleRegistry = deps.registry ?? GAME_MODULES;

  try {
    if (url.pathname === "/api/admin/questions" && request.method === "GET") {
      return json(await listAdminQuestions(store, deps.now(), registry));
    }

    if (url.pathname === "/api/admin/questions/status" && request.method === "POST") {
      const parsed = StatusRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) return json({ error: "Ungültige Anfrage." }, 400);
      const { items, status } = parsed.data;
      await store.setStatus(items, status, deps.now());
      invalidateContentFilter();
      if (status === "removed") {
        // One replacement per removed question, one after another (daily limit).
        deps.background(
          (async () => {
            for (const item of items) await replaceQuestion(deps.replaceDeps(store), item);
            invalidateContentFilter();
          })(),
        );
      }
      return json({ ok: true, replacing: status === "removed" ? items.length : 0 });
    }

    const edit = url.pathname.match(/^\/api\/admin\/questions\/([^/]+)$/);
    if (edit && request.method === "PUT") {
      const id = decodeURIComponent(edit[1]!);
      const row = (await store.listGenerated()).find((r) => r.id === id);
      if (!row) return json({ error: "Nur neu generierte Fragen können bearbeitet werden." }, 404);
      const body = (await readJson(request)) as { payload?: unknown } | undefined;
      const module = getModule(row.category_id, registry);
      if (!module?.parseContent || !body || typeof body.payload !== "object" || body.payload === null) {
        return json({ error: "Ungültige Anfrage." }, 400);
      }
      // The id stays the same – stats keep referring to it.
      const parsed = module.parseContent({ ...body.payload, id });
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      await store.updateGenerated(id, JSON.stringify(parsed.value), deps.now());
      invalidateContentFilter();
      return json({ ok: true });
    }
  } catch (err) {
    console.warn(`admin: request failed (${err instanceof Error ? err.message.slice(0, 80) : "error"})`);
    return json({ error: "Datenbank nicht erreichbar." }, 503);
  }

  return json({ error: "Not found" }, 404);
}
