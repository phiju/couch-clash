"use client";

import {
  CATEGORY_METAS,
  categoryAvailable,
  getCategoryMeta,
  normalizeCategoryOptions,
  normalizeScoring,
} from "@couch-clash/games/meta";
import {
  estimateGameSeconds,
  formatDuration,
  type CategoryMeta,
  type ClientMessage,
  type GameRoundSettings,
  type ScoringSettings,
} from "@couch-clash/shared";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui";
import { setupStore } from "@/lib/storage";

interface CategoryChoice {
  enabled: boolean;
  questionCount: number;
  scoring: ScoringSettings;
  /** CategoryMeta.options (id → on/off). */
  options: Record<string, boolean>;
}

interface SetupState {
  /** Category ids in play order. */
  order: string[];
  choices: Record<string, CategoryChoice>;
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
  for (const meta of CATEGORY_METAS) choices[meta.id] = sanitizeChoice(meta, stored?.choices?.[meta.id]);
  const ids = CATEGORY_METAS.map((m) => m.id as string);
  const storedOrder = (stored?.order ?? []).filter((id) => ids.includes(id));
  return { order: [...storedOrder, ...ids.filter((id) => !storedOrder.includes(id))], choices };
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
  const serverIds = server.map((r) => r.categoryId).filter((id) => base.order.includes(id));
  return { order: [...serverIds, ...base.order.filter((id) => !serverIds.includes(id))], choices };
}

function toRounds(setup: SetupState, playerCount: number): GameRoundSettings[] {
  return setup.order
    .filter((id) => {
      const meta = getCategoryMeta(id);
      return setup.choices[id]?.enabled && !!meta && categoryAvailable(meta, playerCount);
    })
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

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
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
  playerCount,
}: {
  serverSettings: GameRoundSettings[] | null;
  send: (msg: ClientMessage) => void;
  /** Connected and authenticated as host. */
  canSend: boolean;
  compact?: boolean;
  /** Set to a function that flushes pending changes and starts the game. */
  startRef: RefObject<(() => void) | null>;
  /** Players in the room – categories with a minimum are hidden from the plan below it. */
  playerCount: number;
}) {
  const [setup, setSetup] = useState<SetupState>(() => initialSetup(serverSettings));
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setupStore.set(setup);
    if (!canSend) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      send({ type: "update_settings", rounds: toRounds(setup, playerCount) });
    }, 250);
    return () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [setup, send, canSend, playerCount]);

  useEffect(() => {
    startRef.current = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      // Same socket, in order: the room has the latest settings before it starts.
      send({ type: "update_settings", rounds: toRounds(setup, playerCount) });
      send({ type: "start_game" });
    };
  }, [setup, send, startRef, playerCount]);

  const metas: CategoryMeta[] = setup.order
    .map((id) => CATEGORY_METAS.find((m) => m.id === id))
    .filter((m): m is (typeof CATEGORY_METAS)[number] => !!m);
  const selected = metas.filter((m) => setup.choices[m.id]?.enabled && categoryAvailable(m, playerCount));
  const seconds = estimateGameSeconds(
    selected.map((meta) => ({ meta, questionCount: setup.choices[meta.id]!.questionCount })),
  );

  const update = (id: string, patch: Partial<CategoryChoice>) =>
    setSetup((s) => ({ ...s, choices: { ...s.choices, [id]: { ...s.choices[id]!, ...patch } } }));
  const updateScoring = (id: string, patch: Partial<ScoringSettings>) =>
    setSetup((s) => ({
      ...s,
      choices: { ...s.choices, [id]: { ...s.choices[id]!, scoring: { ...s.choices[id]!.scoring, ...patch } } },
    }));

  function randomize() {
    setSetup((s) => {
      const order = shuffled(s.order);
      const available = order.filter((id) => {
        const meta = getCategoryMeta(id);
        return !!meta && categoryAvailable(meta, playerCount);
      });
      const pick = new Set(available.slice(0, 1 + Math.floor(Math.random() * available.length)));
      const choices = Object.fromEntries(
        Object.entries(s.choices).map(([id, c]) => [id, { ...c, enabled: pick.has(id) }]),
      );
      return { order, choices };
    });
  }

  return (
    <div className={`flex w-full flex-col ${compact ? "gap-[1.4vh]" : "gap-4"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`font-bold ${compact ? "fs-xl" : "text-4xl lg:text-6xl"}`}>Was spielen wir?</h2>
        <Button variant="secondary" onClick={randomize} className={compact ? "fs-md !px-4 !py-1.5" : "px-4 py-2 text-lg"}>
          🎲 Zufall
        </Button>
      </div>

      <ul className={`grid w-full ${compact ? "gap-[1.4vh]" : "gap-4 lg:grid-cols-2"}`}>
        {metas.map((meta) => {
          const available = categoryAvailable(meta, playerCount);
          const c = { ...setup.choices[meta.id]!, enabled: setup.choices[meta.id]!.enabled && available };
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
                    disabled={!available}
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
                    disabled={!available}
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

              {!available && (
                <p className={`font-bold text-cream/80 ${compact ? "fs-sm" : "text-lg"}`}>
                  👥 Erst ab {meta.minPlayers} Spielern spielbar
                </p>
              )}
              {c.enabled && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className={`flex justify-between font-bold ${compact ? "fs-md" : "text-lg"}`}>
                      <span>Fragen</span>
                      <span className="text-bulb">{c.questionCount}</span>
                    </span>
                    <input
                      type="range"
                      min={meta.questionsPerRound.min}
                      max={meta.questionsPerRound.max}
                      value={c.questionCount}
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
  return (
    <details className="rounded-2xl bg-petrol-dark/60 p-3">
      <summary className="cursor-pointer text-base font-bold text-cream/80">Punkte-Einstellungen</summary>
      <div className="mt-3 grid gap-3 text-base">
        {fields.has("maxPoints") && (
          <label className="flex items-center justify-between gap-4">
            <span>{MAX_POINTS_LABEL[scoring.mode]}</span>
            <input
              type="number"
              min={0}
              max={10000}
              step={10}
              value={scoring.maxPoints}
              onChange={(e) => onChange({ maxPoints: clamp(Math.round(Number(e.target.value) || 0), 0, 10000) })}
              className="w-24 rounded-xl bg-cream px-3 py-1 text-right font-bold text-brown"
            />
          </label>
        )}
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
        {bluff ? (
          <p className="text-sm text-cream/70">
            Pro reingelegtem Mitspieler {Math.round(scoring.maxPoints / 2)} Punkte, eigene richtige Erklärung {scoring.maxPoints} Punkte.
          </p>
        ) : (
          <p className="text-sm text-cream/70">Höchstens {max} Punkte pro Frage.</p>
        )}
        <button type="button" onClick={onReset} className="self-start text-sm text-cream/60 underline">
          Standard wiederherstellen
        </button>
      </div>
    </details>
  );
}
