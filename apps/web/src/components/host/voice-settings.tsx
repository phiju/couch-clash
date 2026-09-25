"use client";

import { useState } from "react";
import {
  CHEEKINESS_LEVELS,
  COMMENT_FREQUENCIES,
  SPEECH_TEMPOS,
  type ClientMessage,
  type PublicRoomState,
  type VoiceSettings,
  accountUsageText,
  voiceErrorHint,
} from "@couch-clash/shared";

const FREQUENCY_LABEL = { selten: "selten", normal: "normal", oft: "oft" } as const;
const CHEEKINESS_LABEL = { nett: "😇 nett", frech: "😏 frech", gnadenlos: "😈 gnadenlos" } as const;
const TEMPO_LABEL = { normal: "normal", schnell: "schnell", turbo: "turbo" } as const;

export const VOICE_UNAVAILABLE_NOTE = "Neue Moderator-Sätze gerade nicht möglich (ElevenLabs-Kontingent?) – er nutzt seine gespeicherten Sprüche.";
export const VOICE_BUDGET_NOTE = "Budget für diesen Raum aufgebraucht – der Moderator nutzt nur noch seine gespeicherten Sprüche.";
export const VOICE_ACCOUNT_LOW_NOTE = "Weniger als 10 % der ElevenLabs-Credits übrig – bis zum Monatsende nur gespeicherte Sprüche.";

/** "🎙️ Moderator spricht", Kommentare, Frechheit, Sprechtempo and "Moderator testen" (lobby). */
export function VoiceSettingsPanel({
  voice,
  send,
  canSend,
  compact = false,
}: {
  voice: PublicRoomState["voice"];
  send: (msg: ClientMessage) => void;
  canSend: boolean;
  compact?: boolean;
}) {
  const [tested, setTested] = useState(false);
  if (!voice) return null;
  const settings: VoiceSettings = {
    enabled: voice.enabled,
    frequency: voice.frequency,
    cheekiness: voice.cheekiness,
    cheekinessOverride: voice.cheekinessOverride,
    tempo: voice.tempo,
  };
  // No NEW audio (refused / budget) – cached lines still play, but the test line needs new audio.
  const noNewAudio = voice.status !== "ok";
  const update = (patch: Partial<VoiceSettings>) =>
    send({ type: "update_voice_settings", settings: { ...settings, ...patch } });
  const text = compact ? "fs-md" : "text-lg";

  return (
    <section className={`flex flex-col rounded-3xl chip ${compact ? "gap-[1.2vh] p-[1.6vh]" : "gap-4 p-6"}`} aria-label="Moderator">
      <label className={`flex cursor-pointer items-center justify-between gap-3 font-bold ${compact ? "fs-lg" : "text-2xl"}`}>
        🎙️ Moderator spricht
        <input
          type="checkbox"
          role="switch"
          checked={voice.enabled}
          disabled={!canSend}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="size-6 accent-orange"
        />
      </label>
      {voice.enabled && (
        <>
          <Segmented
            label="Kommentare"
            options={COMMENT_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))}
            value={voice.frequency}
            onChange={(frequency) => update({ frequency })}
            disabled={!canSend}
            className={text}
          />
          <Segmented
            label="Frechheit"
            // The game mode decides which levels exist (Kids: nett or frech).
            options={CHEEKINESS_LEVELS.filter((c) => voice.allowedCheekiness.includes(c)).map((c) => ({
              value: c,
              label: CHEEKINESS_LABEL[c],
            }))}
            value={voice.effectiveCheekiness}
            onChange={(cheekiness) => update({ cheekiness })}
            disabled={!canSend}
            className={text}
          />
          <Segmented
            label="Sprechtempo"
            options={SPEECH_TEMPOS.map((t) => ({ value: t, label: TEMPO_LABEL[t] }))}
            value={voice.tempo}
            onChange={(tempo) => update({ tempo })}
            disabled={!canSend}
            className={text}
          />
          <div className={`flex flex-wrap items-center gap-2 ${text}`}>
            <span className="font-bold text-cream/80">Moderator testen</span>
            <button
              type="button"
              disabled={!canSend || noNewAudio}
              onClick={() => {
                send({ type: "voice_test" });
                setTested(true);
              }}
              className="rounded-full bg-petrol px-3 py-1 font-bold transition hover:bg-orange disabled:opacity-40"
            >
              {tested ? "▶ Nochmal" : "▶ Probe-Spruch"}
            </button>
            <span className={`ml-auto text-cream/55 ${compact ? "fs-sm" : "text-sm"}`} title="ElevenLabs-Credits für neue Sätze in diesem Raum (gespeicherte Sprüche sind gratis)">
              {voice.creditsUsed.toLocaleString("de-DE")} / {voice.creditBudget.toLocaleString("de-DE")} Credits
            </span>
          </div>
          {voice.account && (
            <p className={`text-cream/55 ${compact ? "fs-sm" : "text-sm"}`}>{accountUsageText(voice.account)}</p>
          )}
          {voice.accountLow && voice.status === "ok" && (
            <p role="status" className={`rounded-2xl bg-petrol-dark/70 px-3 py-2 font-bold ${compact ? "fs-sm" : "text-base"}`}>
              {VOICE_ACCOUNT_LOW_NOTE}
            </p>
          )}
          {noNewAudio && (
            <div role="status" className={`flex flex-col gap-1.5 rounded-2xl bg-rust/80 px-3 py-2 ${compact ? "fs-sm" : "text-base"}`}>
              <p className="font-bold">{voice.status === "unavailable" ? VOICE_UNAVAILABLE_NOTE : VOICE_BUDGET_NOTE}</p>
              {voice.status === "unavailable" && (
                <>
                  <p>
                    {voiceErrorHint(voice.errorCode)}
                    {voice.errorCode && <span className="ml-1 font-mono text-cream/75">(Fehler {voice.errorCode})</span>}
                  </p>
                  <button
                    type="button"
                    disabled={!canSend}
                    onClick={() => send({ type: "voice_retry" })}
                    className="self-start rounded-full bg-petrol-dark/70 px-3 py-1 font-bold transition hover:bg-petrol disabled:opacity-40"
                  >
                    ↻ Stimme erneut versuchen
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  dimmed = false,
  className = "",
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <fieldset className={`flex flex-col gap-1.5 ${className}`}>
      <legend className="mb-1 font-bold text-cream/80">{label}</legend>
      <div className={`grid gap-1.5 ${dimmed ? "opacity-50" : ""}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-2 py-1.5 font-bold whitespace-nowrap transition ${
              o.value === value ? "bg-orange text-cream shadow-[0_3px_0_var(--color-rust)]" : "bg-petrol-dark/60 text-cream/75 hover:bg-petrol"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
