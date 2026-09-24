"use client";

import { CATEGORY_METAS, getCategoryMeta } from "@couch-clash/games/meta";
import {
  estimateGameSeconds,
  formatDuration,
  ScoringSettingsSchema,
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
}

interface SetupState {
  /** Category ids in play order. */
  order: string[];
  choices: Record<string, CategoryChoice>;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function defaultChoice(meta: CategoryMeta): CategoryChoice {
  return { enabled: true, questionCount: meta.questionsPerRound.default, scoring: { ...meta.scoring } };
}

function sanitizeChoice(meta: CategoryMeta, raw: Partial<CategoryChoice> | undefined): CategoryChoice {
  if (!raw) return defaultChoice(meta);
  const scoring = ScoringSettingsSchema.safeParse({ ...meta.scoring, ...raw.scoring });
  const { min, max } = meta.questionsPerRound;
  return {
    enabled: raw.enabled !== false,
    questionCount: clamp(Number(raw.questionCount) || meta.questionsPerRound.default, min, max),
    scoring: scoring.success ? scoring.data : { ...meta.scoring },
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

function toRounds(setup: SetupState): GameRoundSettings[] {
  return setup.order
    .filter((id) => setup.choices[id]?.enabled)
    .map((id) => {
      const c = setup.choices[id]!;
      return { categoryId: id, questionCount: c.questionCount, scoring: c.scoring };
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
}: {
  serverSettings: GameRoundSettings[] | null;
  send: (msg: ClientMessage) => void;
  /** Connected and authenticated as host. */
  canSend: boolean;
  compact?: boolean;
  /** Set to a function that flushes pending changes and starts the game. */
  startRef: RefObject<(() => void) | null>;
}) {
  const [setup, setSetup] = useState<SetupState>(() => initialSetup(serverSettings));
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setupStore.set(setup);
    if (!canSend) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      send({ type: "update_settings", rounds: toRounds(setup) });
    }, 250);
    return () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [setup, send, canSend]);

  useEffect(() => {
    startRef.current = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      // Same socket, in order: the room has the latest settings before it starts.
      send({ type: "update_settings", rounds: toRounds(setup) });
      send({ type: "start_game" });
    };
  }, [setup, send, startRef]);

  const metas = setup.order
    .map((id) => CATEGORY_METAS.find((m) => m.id === id))
    .filter((m): m is (typeof CATEGORY_METAS)[number] => !!m);
  const selected = metas.filter((m) => setup.choices[m.id]?.enabled);
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
      const pick = new Set(order.slice(0, 1 + Math.floor(Math.random() * order.length)));
      const choices = Object.fromEntries(
        Object.entries(s.choices).map(([id, c]) => [id, { ...c, enabled: pick.has(id) }]),
      );
      return { order, choices };
    });
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={`font-bold ${compact ? "text-3xl" : "text-4xl lg:text-6xl"}`}>Was spielen wir?</h2>
        <Button variant="secondary" onClick={randomize} className="px-4 py-2 text-lg">
          🎲 Zufall
        </Button>
      </div>

      <ul className={`grid w-full gap-4 ${compact ? "" : "lg:grid-cols-2"}`}>
        {metas.map((meta) => {
          const c = setup.choices[meta.id]!;
          const position = selected.indexOf(meta);
          return (
            <li
              key={meta.id}
              className={`flex flex-col gap-4 rounded-3xl ring-4 transition ${compact ? "p-4" : "p-6"} ${
                c.enabled ? "chip ring-bulb" : "bg-petrol-dark/60 opacity-60 ring-transparent"
              }`}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => update(meta.id, { enabled: e.target.checked })}
                  className="mt-1.5 size-7 shrink-0 accent-[var(--color-orange)]"
                  aria-label={meta.name}
                />
                <span className={compact ? "text-4xl" : "text-6xl"}>{meta.emoji}</span>
                <span className="flex flex-1 flex-col gap-1">
                  <span className={`flex flex-wrap items-center gap-2 font-bold ${compact ? "text-2xl" : "text-3xl lg:text-4xl"}`}>
                    {meta.name}
                    {position >= 0 && (
                      <span className="rounded-full bg-bulb px-2.5 py-0.5 text-base text-brown">{position + 1}.</span>
                    )}
                  </span>
                  {!compact && <span className="text-lg text-cream/70 lg:text-xl">{meta.description}</span>}
                  <span className="flex flex-wrap gap-2 pt-1 text-sm font-bold text-cream/60">
                    <span className="rounded-full chip px-2 py-0.5">ab {meta.ageRating}</span>
                    {!compact &&
                      meta.tags.map((t) => (
                        <span key={t} className="rounded-full chip px-2 py-0.5">
                          {t}
                        </span>
                      ))}
                  </span>
                </span>
              </label>

              {c.enabled && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="flex justify-between text-lg font-bold">
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
                    onReset={() => update(meta.id, { scoring: { ...meta.scoring } })}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xl font-bold text-cream/80">
        {selected.length === 0 ? "Wähle mindestens eine Kategorie" : `Dauer: ${formatDuration(seconds)}`}
      </p>
    </div>
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
  return (
    <details className="rounded-2xl bg-petrol-dark/60 p-3">
      <summary className="cursor-pointer text-base font-bold text-cream/80">Punkte-Einstellungen</summary>
      <div className="mt-3 grid gap-3 text-base">
        {fields.has("basePoints") && (
          <label className="flex items-center justify-between gap-4">
            <span>Punkte pro Frage</span>
            <input
              type="number"
              min={0}
              max={10000}
              step={10}
              value={scoring.basePoints}
              onChange={(e) => onChange({ basePoints: clamp(Math.round(Number(e.target.value) || 0), 0, 10000) })}
              className="w-24 rounded-xl bg-cream px-3 py-1 text-right font-bold text-brown"
            />
          </label>
        )}
        {fields.has("speedBonus") && (
          <label className="flex items-center justify-between gap-4">
            <span>Tempo-Bonus</span>
            <input
              type="checkbox"
              checked={scoring.speedBonus}
              onChange={(e) => onChange({ speedBonus: e.target.checked })}
              className="size-6 accent-[var(--color-orange)]"
            />
          </label>
        )}
        {fields.has("minPercent") && (
          <label className="flex flex-col gap-1">
            <span className="flex justify-between">
              <span>Mindestens für Langsamste / Weiteste</span>
              <span className="font-bold text-bulb">{scoring.minPercent} %</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={scoring.minPercent}
              onChange={(e) => onChange({ minPercent: Number(e.target.value) })}
              className="accent-[var(--color-orange)]"
            />
          </label>
        )}
        {fields.has("estimateScale") && (
          <label className="flex items-center justify-between gap-4">
            <span>Wertung</span>
            <select
              value={scoring.estimateScale}
              onChange={(e) => onChange({ estimateScale: e.target.value as ScoringSettings["estimateScale"] })}
              className="rounded-xl bg-cream px-3 py-1 font-bold text-brown"
            >
              <option value="distance">nach Abstand</option>
              <option value="rank">nach Platzierung</option>
            </select>
          </label>
        )}
        <button type="button" onClick={onReset} className="self-start text-sm text-cream/60 underline">
          Standard wiederherstellen
        </button>
      </div>
    </details>
  );
}
