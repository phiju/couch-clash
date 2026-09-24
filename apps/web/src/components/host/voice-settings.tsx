"use client";

import {
  CHEEKINESS_LEVELS,
  COMMENT_FREQUENCIES,
  type ClientMessage,
  type PublicRoomState,
  type VoiceSettings,
} from "@couch-clash/shared";

const FREQUENCY_LABEL = { selten: "selten", normal: "normal", oft: "oft" } as const;
const CHEEKINESS_LABEL = { nett: "😇 nett", frech: "😏 frech", gnadenlos: "😈 gnadenlos" } as const;

/** "🎙️ Moderator spricht", comment frequency and "Frechheit" (lobby / setup). */
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
  if (!voice) return null;
  const settings: VoiceSettings = {
    enabled: voice.enabled,
    frequency: voice.frequency,
    cheekiness: voice.cheekiness,
    cheekinessOverride: voice.cheekinessOverride,
  };
  const update = (patch: Partial<VoiceSettings>) =>
    send({ type: "update_voice_settings", settings: { ...settings, ...patch } });
  const autoNett = voice.kidsCategories && !voice.cheekinessOverride;
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
            options={CHEEKINESS_LEVELS.map((c) => ({ value: c, label: CHEEKINESS_LABEL[c] }))}
            value={voice.cheekiness}
            onChange={(cheekiness) => update({ cheekiness })}
            disabled={!canSend}
            dimmed={autoNett}
            className={text}
          />
          {voice.kidsCategories && voice.cheekiness !== "nett" && (
            <label className={`flex cursor-pointer items-start gap-2 text-cream/80 ${compact ? "fs-sm" : "text-base"}`}>
              <input
                type="checkbox"
                checked={voice.cheekinessOverride}
                disabled={!canSend}
                onChange={(e) => update({ cheekinessOverride: e.target.checked })}
                className="mt-1 size-4 shrink-0 accent-orange"
              />
              <span>
                {autoNett
                  ? "Kinder-Kategorie gewählt → der Moderator bleibt automatisch nett. Trotzdem "
                  : "Trotz Kinder-Kategorie "}
                <b>{CHEEKINESS_LABEL[voice.cheekiness]}</b>
              </span>
            </label>
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
