"use client";

import { CATEGORY_METAS } from "@couch-clash/games/meta";
import {
  estimateGameSeconds,
  formatDuration,
  ScoringSettingsSchema,
  type CategoryMeta,
  type ClientMessage,
  type PublicRoomState,
  type ScoringSettings,
} from "@couch-clash/shared";
import { useEffect, useState } from "react";
import { AvatarBadge } from "@/components/avatar";
import { Button, Logo, Screen } from "@/components/ui";
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

/** Stored setup merged with the registry (new categories appear, removed ones vanish). */
function loadSetup(): SetupState {
  const stored = setupStore.get<Partial<SetupState>>();
  const choices: Record<string, CategoryChoice> = {};
  for (const meta of CATEGORY_METAS) {
    const s = stored?.choices?.[meta.id];
    const scoring = ScoringSettingsSchema.safeParse({ ...meta.scoring, ...s?.scoring });
    choices[meta.id] = s
      ? {
          enabled: s.enabled !== false,
          questionCount: clamp(
            Number(s.questionCount) || meta.questionsPerRound.default,
            meta.questionsPerRound.min,
            meta.questionsPerRound.max,
          ),
          scoring: scoring.success ? scoring.data : { ...meta.scoring },
        }
      : defaultChoice(meta);
  }
  const ids = CATEGORY_METAS.map((m) => m.id as string);
  const storedOrder = (stored?.order ?? []).filter((id) => ids.includes(id));
  const order = [...storedOrder, ...ids.filter((id) => !storedOrder.includes(id))];
  return { order, choices };
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const AGE_LABEL = (age: number) => (age === 0 ? "ab 0" : `ab ${age}`);

export function HostSetup({
  room,
  send,
  canSend,
}: {
  room: PublicRoomState;
  send: (msg: ClientMessage) => void;
  canSend: boolean;
}) {
  const [setup, setSetup] = useState<SetupState>(loadSetup);

  useEffect(() => {
    setupStore.set(setup);
  }, [setup]);

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
      choices: {
        ...s.choices,
        [id]: { ...s.choices[id]!, scoring: { ...s.choices[id]!.scoring, ...patch } },
      },
    }));

  function randomize() {
    setSetup((s) => {
      const order = shuffled(s.order);
      const count = 1 + Math.floor(Math.random() * order.length);
      const pick = new Set(order.slice(0, count));
      const choices = Object.fromEntries(
        Object.entries(s.choices).map(([id, c]) => [id, { ...c, enabled: pick.has(id) }]),
      );
      return { order, choices };
    });
  }

  function start() {
    send({
      type: "start_game",
      rounds: selected.map((meta) => {
        const c = setup.choices[meta.id]!;
        return { categoryId: meta.id, questionCount: c.questionCount, scoring: c.scoring };
      }),
    });
  }

  return (
    <Screen className="max-w-[1600px] gap-8 lg:py-10">
      <header className="flex w-full flex-wrap items-center justify-between gap-4">
        <Logo className="text-4xl" />
        <div className="flex -space-x-3">
          {room.players.map((p) => (
            <AvatarBadge key={p.id} avatar={p.avatar} size="sm" dimmed={!p.connected} />
          ))}
        </div>
      </header>

      <div className="flex w-full flex-wrap items-end justify-between gap-4">
        <h2 className="text-4xl font-black lg:text-6xl">Was spielen wir?</h2>
        <Button variant="secondary" onClick={randomize} className="text-xl">
          🎲 Zufall
        </Button>
      </div>

      <ul className="grid w-full gap-6 lg:grid-cols-2">
        {metas.map((meta) => {
          const c = setup.choices[meta.id]!;
          const position = selected.indexOf(meta);
          return (
            <li
              key={meta.id}
              className={`flex flex-col gap-5 rounded-[2rem] p-6 ring-4 transition ${
                c.enabled ? "bg-white/10 ring-spot" : "bg-white/5 opacity-60 ring-transparent"
              }`}
            >
              <label className="flex cursor-pointer items-start gap-4">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => update(meta.id, { enabled: e.target.checked })}
                  className="mt-2 size-8 shrink-0 accent-[var(--color-spot)]"
                />
                <span className="text-6xl">{meta.emoji}</span>
                <span className="flex flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-3 text-3xl font-black lg:text-4xl">
                    {meta.name}
                    {position >= 0 && (
                      <span className="rounded-full bg-spot px-3 py-0.5 text-lg text-stage">{position + 1}.</span>
                    )}
                  </span>
                  <span className="text-lg text-white/70 lg:text-xl">{meta.description}</span>
                  <span className="flex flex-wrap gap-2 pt-1 text-sm font-bold text-white/60">
                    <span className="rounded-full bg-white/10 px-2 py-0.5">{AGE_LABEL(meta.ageRating)}</span>
                    {meta.tags.map((t) => (
                      <span key={t} className="rounded-full bg-white/10 px-2 py-0.5">
                        {t}
                      </span>
                    ))}
                  </span>
                </span>
              </label>

              {c.enabled && (
                <>
                  <label className="flex flex-col gap-2">
                    <span className="flex justify-between text-xl font-bold">
                      <span>Fragen</span>
                      <span className="text-spot">{c.questionCount}</span>
                    </span>
                    <input
                      type="range"
                      min={meta.questionsPerRound.min}
                      max={meta.questionsPerRound.max}
                      value={c.questionCount}
                      onChange={(e) => update(meta.id, { questionCount: Number(e.target.value) })}
                      className="w-full accent-[var(--color-spot)]"
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

      <footer className="mt-auto flex w-full flex-wrap items-center justify-between gap-4">
        <Button variant="secondary" onClick={() => send({ type: "back_to_lobby" })} className="text-xl">
          ← Zurück zur Lobby
        </Button>
        <div className="flex flex-wrap items-center gap-6">
          <p className="text-2xl font-bold text-white/80">
            {selected.length === 0 ? "Wähle mindestens eine Kategorie" : `Dauer: ${formatDuration(seconds)}`}
          </p>
          <Button onClick={start} disabled={selected.length === 0 || !canSend} className="px-12 py-6 text-4xl">
            Los geht&apos;s!
          </Button>
        </div>
      </footer>
    </Screen>
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
    <details className="rounded-2xl bg-black/20 p-4">
      <summary className="cursor-pointer text-lg font-bold text-white/80">Punkte-Einstellungen</summary>
      <div className="mt-4 grid gap-4 text-lg">
        {fields.has("basePoints") && (
          <label className="flex items-center justify-between gap-4">
            <span>Punkte pro Frage</span>
            <input
              type="number"
              min={0}
              max={10000}
              step={10}
              value={scoring.basePoints}
              onChange={(e) =>
                onChange({ basePoints: clamp(Math.round(Number(e.target.value) || 0), 0, 10000) })
              }
              className="w-28 rounded-xl bg-white px-3 py-1 text-right font-bold text-stage"
            />
          </label>
        )}
        {fields.has("speedBonus") && (
          <label className="flex items-center justify-between gap-4">
            <span>Tempo-Bonus (Schnellere bekommen mehr)</span>
            <input
              type="checkbox"
              checked={scoring.speedBonus}
              onChange={(e) => onChange({ speedBonus: e.target.checked })}
              className="size-6 accent-[var(--color-spot)]"
            />
          </label>
        )}
        {fields.has("minPercent") && (
          <label className="flex flex-col gap-1">
            <span className="flex justify-between">
              <span>Mindestens für Langsamste / Weiteste</span>
              <span className="font-bold text-spot">{scoring.minPercent} %</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={scoring.minPercent}
              onChange={(e) => onChange({ minPercent: Number(e.target.value) })}
              className="accent-[var(--color-spot)]"
            />
          </label>
        )}
        {fields.has("estimateScale") && (
          <label className="flex items-center justify-between gap-4">
            <span>Wertung</span>
            <select
              value={scoring.estimateScale}
              onChange={(e) => onChange({ estimateScale: e.target.value as ScoringSettings["estimateScale"] })}
              className="rounded-xl bg-white px-3 py-1 font-bold text-stage"
            >
              <option value="distance">nach Abstand</option>
              <option value="rank">nach Platzierung</option>
            </select>
          </label>
        )}
        <button type="button" onClick={onReset} className="self-start text-base text-white/60 underline">
          Standard wiederherstellen
        </button>
      </div>
    </details>
  );
}
