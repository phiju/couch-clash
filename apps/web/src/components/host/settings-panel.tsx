"use client";

import {
  CATEGORY_METAS,
  getCategoryMeta,
  normalizeCategoryOptions,
  normalizeScoring,
  PLANNER_CONFIG,
  planGame,
} from "@couch-clash/games/meta";
import {
  DEFAULT_PER_QUESTION_CAP,
  estimateGameSeconds,
  formatDuration,
  type CategoryMeta,
  type ClientMessage,
  type GameModeSettings,
  type GameRoundSettings,
  GAME_MODE_INFO,
  type ScoringSettings,
} from "@couch-clash/shared";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui";
import { setupStore } from "@/lib/storage";
import { SETUP_VERSION, isAvailable, mergeLibraryOrder, migrateQuizScoring } from "@/lib/setup-rules";
import { ModePicker } from "./mode-picker";

interface CategoryChoice {
  enabled: boolean;
  questionCount: number;
  scoring: ScoringSettings;
  /** CategoryMeta.options (id → on/off). */
  options: Record<string, boolean>;
}

interface SetupState {
  order: string[];
  choices: Record<string, CategoryChoice>;
  /** "Spieldauer" for Zufall (minutes). */
  minutes: number;
  /** The Zufall plan (may repeat a category) – null once the host edits by hand ("manuell"). */
  plan: GameRoundSettings[] | null;
  /** Saved-settings version (SETUP_VERSION). */
  version?: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function defaultChoice(meta: CategoryMeta): CategoryChoice {
  return {
    enabled: true,
    questionCount: meta.questionsPerRound.default,
    scoring: structuredClone(meta.scoring),
    options: normalizeCategoryOptions(meta, undefined),
  };
}

function sanitizeChoice(meta: CategoryMeta, raw: Partial<CategoryChoice> | undefined): CategoryChoice {
  if (!raw) return defaultChoice(meta);
  const { min, max } = meta.questionsPerRound;
  return {
    enabled: raw.enabled !== false,
    questionCount: clamp(Number(raw.questionCount) || meta.questionsPerRound.default, min, max),
    // Old saved shapes (before the scoring refactor) fall back to the defaults.
    scoring: normalizeScoring(meta, raw.scoring),
    options: normalizeCategoryOptions(meta, raw.options),
  };
}

/** Last used settings on this device, merged with the registry. */
function loadStoredSetup(): SetupState {
  const stored = setupStore.get<Partial<SetupState>>();
  const choices: Record<string, CategoryChoice> = {};
  for (const meta of CATEGORY_METAS) {
    const raw = stored?.choices?.[meta.id];
    const migrated = raw && meta.id === "quiz" ? { ...raw, scoring: migrateQuizScoring(raw.scoring, stored?.version) } : raw;
    choices[meta.id] = sanitizeChoice(meta, migrated);
  }
  const ids = CATEGORY_METAS.map((m) => m.id as string);
  const minutes = (PLANNER_CONFIG.durations as readonly number[]).includes(Number(stored?.minutes))
    ? Number(stored!.minutes)
    : PLANNER_CONFIG.defaultMinutes;
  const plan = Array.isArray(stored?.plan) ? (stored!.plan as GameRoundSettings[]).filter((r) => !!getCategoryMeta(r.categoryId)) : null;
  return {
    order: mergeLibraryOrder(stored?.order ?? [], ids),
    choices,
    minutes,
    plan: plan?.length ? plan : null,
    version: SETUP_VERSION,
  };
}

/** Server settings win (e.g. after a reload); otherwise the device's last settings. */
function initialSetup(server: GameRoundSettings[] | null): SetupState {
  const base = loadStoredSetup();
  if (!server || server.length === 0) return base;
  const choices = { ...base.choices };
  for (const id of base.order) choices[id] = { ...choices[id]!, enabled: false };
  for (const round of server) {
    const meta = getCategoryMeta(round.categoryId);
    if (meta) choices[meta.id] = sanitizeChoice(meta, { ...round, enabled: true });
  }
  const serverIds = [...new Set(server.map((r) => r.categoryId))].filter((id) => base.order.includes(id));
  // A category twice → it was a Zufall plan.
  const plan = serverIds.length < server.length ? server : null;
  return { ...base, order: [...serverIds, ...base.order.filter((id) => !serverIds.includes(id))], choices, plan };
}

/** The plan as cards: every planned category checked, with its first round's question count. */
function planToCards(s: SetupState): SetupState {
  if (!s.plan) return s;
  const choices = { ...s.choices };
  for (const id of s.order) choices[id] = { ...choices[id]!, enabled: false };
  const firstIds: string[] = [];
  for (const round of s.plan) {
    if (firstIds.includes(round.categoryId)) continue;
    firstIds.push(round.categoryId);
    choices[round.categoryId] = { ...choices[round.categoryId]!, enabled: true, questionCount: round.questionCount };
  }
  return { ...s, choices, order: [...firstIds, ...s.order.filter((id) => !firstIds.includes(id))], plan: null };
}

function toRounds(setup: SetupState, mode: GameModeSettings, pools: Record<string, number> | null): GameRoundSettings[] {
  const ok = (id: string) => {
    const meta = getCategoryMeta(id);
    return !!meta && isAvailable(meta, mode, pools);
  };
  if (setup.plan) {
    return setup.plan
      .filter((r) => ok(r.categoryId))
      .map((r) => {
        const c = setup.choices[r.categoryId]!;
        const meta = getCategoryMeta(r.categoryId);
        return { ...r, scoring: c.scoring, ...(meta?.options?.length ? { options: c.options } : {}) };
      });
  }
  return setup.order
    .filter((id) => setup.choices[id]?.enabled && ok(id))
    .map((id) => {
      const c = setup.choices[id]!;
      const meta = getCategoryMeta(id);
      return {
        categoryId: id,
        questionCount: c.questionCount,
        scoring: c.scoring,
        ...(meta?.options?.length ? { options: c.options } : {}),
      };
    });
}



/**
 * Host-only game settings. Local state for snappy editing; every change is
 * stored on the device and sent to the room (debounced), which validates it.
 */
export function GameSettingsPanel({
  serverSettings,
  send,
  canSend,
  compact = false,
  startRef,
  mode,
  partyConfirmed,
  poolSizes,
}: {
  serverSettings: GameRoundSettings[] | null;
  send: (msg: ClientMessage) => void;
  /** Connected and authenticated as host. */
  canSend: boolean;
  compact?: boolean;
  /** Set to a function that flushes pending changes and starts the game. */
  startRef: RefObject<(() => void) | null>;
  /** Global game mode (server state). */
  mode: GameModeSettings;
  partyConfirmed: boolean;
  /** Eligible questions per category in this mode (server). */
  poolSizes: Record<string, number> | null;
}) {
  const [setup, setSetup] = useState<SetupState>(() => initialSetup(serverSettings));
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setupStore.set(setup);
    if (!canSend) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      send({ type: "update_settings", rounds: toRounds(setup, mode, poolSizes) });
    }, 250);
    return () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [setup, send, canSend, mode, poolSizes]);

  useEffect(() => {
    startRef.current = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      // Same socket, in order: the room has the latest settings before it starts.
      send({ type: "update_settings", rounds: toRounds(setup, mode, poolSizes) });
      send({ type: "start_game" });
    };
  }, [setup, send, startRef, mode, poolSizes]);

  const metas: CategoryMeta[] = setup.order
    .map((id) => CATEGORY_METAS.find((m) => m.id === id))
    .filter((m): m is (typeof CATEGORY_METAS)[number] => !!m);
  const available = (m: CategoryMeta) => isAvailable(m, mode, poolSizes);
  // The panel only lists categories offered in the current mode.
  const listed = metas.filter((m) => m.modes.includes(mode.mode));
  // Checked before, but not offered in this mode → note (kept for when the mode changes back).
  const droppedByMode = metas.filter((m) => setup.choices[m.id]?.enabled && !m.modes.includes(mode.mode));
  const view = setup.plan ? planToCards(setup) : setup;
  const selected = listed.filter((m) => view.choices[m.id]?.enabled && available(m));
  const rounds = toRounds(setup, mode, poolSizes);
  const seconds = estimateGameSeconds(
    rounds.flatMap((r) => {
      const meta = getCategoryMeta(r.categoryId);
      return meta ? [{ meta, questionCount: r.questionCount }] : [];
    }),
  );

  // Any manual change ends the Zufall plan ("manuell").
  const update = (id: string, patch: Partial<CategoryChoice>) =>
    setSetup((prev) => {
      const s = planToCards(prev);
      return { ...s, choices: { ...s.choices, [id]: { ...s.choices[id]!, ...patch } } };
    });
  const updateScoring = (id: string, patch: Partial<ScoringSettings>) =>
    setSetup((prev) => {
      const s = planToCards(prev);
      return { ...s, choices: { ...s.choices, [id]: { ...s.choices[id]!, scoring: { ...s.choices[id]!.scoring, ...patch } } } };
    });

  /** Zufall: a random plan that fills the chosen Spieldauer. */
  function randomize(minutes = setup.minutes) {
    setSetup((s) => {
      const planned = planGame({
        mode: mode.mode,
        targetMinutes: minutes,
        categories: CATEGORY_METAS,
        pools: poolSizes ?? {},
        random: Math.random,
      });
      if (planned.rounds.length === 0) return { ...s, minutes };
      const plan = planned.rounds.map((r) => ({ ...r, scoring: s.choices[r.categoryId]!.scoring }));
      return { ...s, minutes, plan };
    });
  }
  const setMinutes = (minutes: number) => {
    if (setup.plan) randomize(minutes);
    else setSetup((s) => ({ ...s, minutes }));
  };

  return (
    <div className={`flex w-full flex-col ${compact ? "gap-[1.4vh]" : "gap-4"}`}>
      <ModePicker mode={mode} partyConfirmed={partyConfirmed} send={send} canSend={canSend} compact={compact} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`font-bold ${compact ? "fs-xl" : "text-4xl lg:text-6xl"}`}>Was spielen wir?</h2>
        <Button variant="secondary" onClick={() => randomize()} className={compact ? "fs-md !px-4 !py-1.5" : "px-4 py-2 text-lg"}>
          🎲 Zufall
        </Button>
      </div>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${compact ? "fs-sm" : "text-base"}`}>
        <span className="font-bold text-cream/80">Spieldauer {setup.plan ? "" : <span className="font-normal text-cream/60">· manuell</span>}</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Spieldauer">
          {PLANNER_CONFIG.durations.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={setup.minutes === m}
              onClick={() => setMinutes(m)}
              className={`rounded-full px-3 py-1 font-bold ${
                setup.minutes === m && setup.plan ? "bg-bulb text-brown" : setup.minutes === m ? "bg-cream/30" : "bg-petrol-dark/70 text-cream/80"
              }`}
            >
              {m} Min
            </button>
          ))}
        </div>
      </div>
      {setup.plan && (
        <ol className={`flex flex-col gap-1 rounded-2xl bg-petrol-dark/60 p-3 ${compact ? "fs-sm" : "text-base"}`} aria-label="Spielplan">
          {rounds.map((r, i) => {
            const meta = getCategoryMeta(r.categoryId);
            return (
              <li key={i} className="flex items-center gap-2">
                <span className="w-6 text-right font-bold text-bulb">{i + 1}.</span>
                <span>{meta?.emoji}</span>
                <span className="flex-1 font-bold">{meta?.name}</span>
                <span className="text-cream/70">{r.questionCount} Fragen</span>
              </li>
            );
          })}
        </ol>
      )}
      {droppedByMode.length > 0 && (
        <p className={`rounded-xl bg-petrol-dark/60 px-3 py-2 text-cream/80 ${compact ? "fs-sm" : "text-base"}`}>
          Im Modus {GAME_MODE_INFO[mode.mode].label} nicht dabei: {droppedByMode.map((m) => `${m.emoji} ${m.name}`).join(", ")}
        </p>
      )}

      <ul className={`grid w-full ${compact ? "gap-[1.4vh]" : "gap-4 lg:grid-cols-2"}`}>
        {listed.map((meta) => {
          const ok = available(meta);
          const c = { ...view.choices[meta.id]!, enabled: view.choices[meta.id]!.enabled && ok };
          const pool = poolSizes?.[meta.id] ?? Infinity;
          const maxQuestions = Math.min(meta.questionsPerRound.max, pool);
          const position = selected.indexOf(meta);
          return (
            <li
              key={meta.id}
              className={`flex flex-col rounded-3xl ring-4 transition ${compact ? "gap-[1.2vh] p-[1.6vh]" : "gap-4 p-6"} ${
                c.enabled ? "chip ring-bulb" : "bg-petrol-dark/60 opacity-60 ring-transparent"
              }`}
            >
              {compact ? (
                // Lobby: checkbox, icon, name, order badge and age badge in one row.
                <label className="flex min-w-0 cursor-pointer items-center gap-[0.6vw]">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    disabled={!ok}
                    onChange={(e) => update(meta.id, { enabled: e.target.checked })}
                    className="size-[clamp(1.1rem,2.6vh,1.75rem)] shrink-0 accent-[var(--color-orange)]"
                    aria-label={meta.name}
                  />
                  <span className="fs-xl shrink-0">{meta.emoji}</span>
                  <span className="fs-lg min-w-0 truncate font-bold" title={meta.name}>
                    {meta.name}
                  </span>
                  {position >= 0 && (
                    <span className="fs-sm shrink-0 rounded-full bg-bulb px-2 py-0.5 font-bold text-brown">
                      {position + 1}.
                    </span>
                  )}
                  <span className="fs-sm ml-auto shrink-0 rounded-full chip px-2 py-0.5 font-bold whitespace-nowrap text-cream/70">
                    ab {meta.ageRating}
                  </span>
                </label>
              ) : (
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    disabled={!ok}
                    onChange={(e) => update(meta.id, { enabled: e.target.checked })}
                    className="mt-1.5 size-7 shrink-0 accent-[var(--color-orange)]"
                    aria-label={meta.name}
                  />
                  <span className="text-6xl">{meta.emoji}</span>
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-3xl font-bold lg:text-4xl">
                      {meta.name}
                      {position >= 0 && (
                        <span className="rounded-full bg-bulb px-2.5 py-0.5 text-base text-brown">{position + 1}.</span>
                      )}
                    </span>
                    <span className="text-lg text-cream/70 lg:text-xl">{meta.description}</span>
                    <span className="flex flex-wrap gap-2 pt-1 text-sm font-bold text-cream/60">
                      <span className="rounded-full chip px-2 py-0.5">ab {meta.ageRating}</span>
                      {meta.tags.map((t) => (
                        <span key={t} className="rounded-full chip px-2 py-0.5">
                          {t}
                        </span>
                      ))}
                    </span>
                  </span>
                </label>
              )}

              {pool < meta.questionsPerRound.min ? (
                <p className={`font-bold text-orange ${compact ? "fs-sm" : "text-lg"}`}>
                  ⚠️ Zu wenige passende Fragen im Modus {GAME_MODE_INFO[mode.mode].label}
                </p>
              ) : (
                pool < meta.questionsPerRound.max && (
                  <p className={`text-cream/70 ${compact ? "fs-sm" : "text-base"}`}>
                    ⚠️ Nur {pool} passende Fragen in diesem Modus
                  </p>
                )
              )}
              {c.enabled && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className={`flex justify-between font-bold ${compact ? "fs-md" : "text-lg"}`}>
                      <span>Fragen</span>
                      <span className="text-bulb">{Math.min(c.questionCount, maxQuestions)}</span>
                    </span>
                    <input
                      type="range"
                      min={meta.questionsPerRound.min}
                      max={maxQuestions}
                      value={Math.min(c.questionCount, maxQuestions)}
                      onChange={(e) => update(meta.id, { questionCount: Number(e.target.value) })}
                      className="w-full accent-[var(--color-orange)]"
                      aria-label={`Fragen ${meta.name}`}
                    />
                  </label>
                  <ScoringEditor
                    meta={meta}
                    scoring={c.scoring}
                    onChange={(patch) => updateScoring(meta.id, patch)}
                    onReset={() => update(meta.id, { scoring: structuredClone(meta.scoring) })}
                  />
                  {meta.options?.map((option) => (
                    <label key={option.id} className={`flex items-center justify-between gap-4 ${compact ? "fs-sm" : "text-base"}`}>
                      <span>{option.label}</span>
                      <input
                        type="checkbox"
                        checked={c.options[option.id] ?? option.default}
                        onChange={(e) => update(meta.id, { options: { ...c.options, [option.id]: e.target.checked } })}
                        className="size-6 shrink-0 accent-[var(--color-orange)]"
                      />
                    </label>
                  ))}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <p className={`font-bold text-cream/80 ${compact ? "fs-md" : "text-xl"}`}>
        {selected.length === 0 ? "Wähle mindestens eine Kategorie" : `Dauer: ${formatDuration(seconds)}`}
      </p>
    </div>
  );
}

const MAX_POINTS_LABEL: Record<ScoringSettings["mode"], string> = {
  absolute: "Punkte für eine richtige Antwort",
  proximity: "Punkte für einen Volltreffer",
  bluff: "Punkte für die echte Erklärung",
};

function PointsInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={10000}
        step={10}
        value={value}
        onChange={(e) => onChange(clamp(Math.round(Number(e.target.value) || 0), 0, 10000))}
        className="w-24 rounded-xl bg-cream px-3 py-1 text-right font-bold text-brown"
      />
    </label>
  );
}

function ScoringEditor({
  meta,
  scoring,
  onChange,
  onReset,
}: {
  meta: CategoryMeta;
  scoring: ScoringSettings;
  onChange: (patch: Partial<ScoringSettings>) => void;
  onReset: () => void;
}) {
  const fields = new Set(meta.scoringFields);
  const speed = scoring.speedModifier;
  const setSpeed = (patch: Partial<ScoringSettings["speedModifier"]>) =>
    onChange({ speedModifier: { ...speed, ...patch } });
  const multiplier = (v: string) => Math.round(clamp(Number(v) || 0, 0, 5) * 100) / 100;
  const max = Math.round(scoring.maxPoints * (speed.enabled ? speed.fastestMultiplier : 1));
  const bluff = scoring.mode === "bluff";
  const cap = scoring.perQuestionCap ?? DEFAULT_PER_QUESTION_CAP;
  return (
    <details className="rounded-2xl bg-petrol-dark/60 p-3">
      <summary className="cursor-pointer text-base font-bold text-cream/80">Punkte-Einstellungen</summary>
      <div className="mt-3 grid gap-3 text-base">
        {fields.has("maxPoints") && (
          <PointsInput label={MAX_POINTS_LABEL[scoring.mode]} value={scoring.maxPoints} onChange={(maxPoints) => onChange({ maxPoints })} />
        )}
        {fields.has("points") &&
          (meta.scoringPoints ?? []).map((p) => (
            <PointsInput
              key={p.id}
              label={p.label}
              value={scoring.points?.[p.id] ?? p.default}
              onChange={(value) => onChange({ points: { ...scoring.points, [p.id]: value } })}
            />
          ))}
        {fields.has("speedModifier") && (
          <>
            <label className="flex items-center justify-between gap-4">
              <span>Tempo-Bonus (schnelle Antworten zählen mehr)</span>
              <input
                type="checkbox"
                checked={speed.enabled}
                onChange={(e) => setSpeed({ enabled: e.target.checked })}
                className="size-6 accent-[var(--color-orange)]"
              />
            </label>
            {speed.enabled && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-cream/80">Sofort geantwortet ×</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={speed.fastestMultiplier}
                    onChange={(e) => setSpeed({ fastestMultiplier: multiplier(e.target.value) })}
                    className="rounded-xl bg-cream px-3 py-1 text-right font-bold text-brown"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-cream/80">Bei Zeitablauf ×</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={speed.slowestMultiplier}
                    onChange={(e) => setSpeed({ slowestMultiplier: multiplier(e.target.value) })}
                    className="rounded-xl bg-cream px-3 py-1 text-right font-bold text-brown"
                  />
                </label>
              </div>
            )}
          </>
        )}
        {fields.has("perQuestionCap") && (
          <PointsInput label="Höchstens pro Frage" value={cap} onChange={(perQuestionCap) => onChange({ perQuestionCap })} />
        )}
        {bluff ? (
          <p className="text-sm text-cream/70">
            Wer alle anderen reinlegt, bekommt den vollen Bonus – sonst anteilig. Höchstens {cap} Punkte pro Wort.
          </p>
        ) : (
          <p className="text-sm text-cream/70">Höchstens {Math.min(max, cap)} Punkte pro Frage.</p>
        )}
        <button type="button" onClick={onReset} className="self-start text-sm text-cream/60 underline">
          Standard wiederherstellen
        </button>
      </div>
    </details>
  );
}
