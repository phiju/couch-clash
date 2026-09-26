"use client";

/**
 * Developer mode: every sound on its own, through the real audio engine
 * (same buses, levels and limiter as in the game). Open /dev/sounds – in
 * `next dev` right away, in production once with ?dev=1 (remembered on
 * this device, ?dev=0 turns it off again).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Screen } from "@/components/ui";
import { useAudioState } from "@/lib/audio/react";
import { devModeOn } from "@/lib/dev-mode";
import {
  EFFECT_IDS,
  MUSIC_IDS,
  SURVIVAL_LOOP_IDS,
  SURVIVAL_ONE_SHOT_IDS,
  type AudioId,
  type SurvivalLoopId,
} from "@/lib/audio/scenes";

const noop = () => () => {};

type Status = { state: "ok"; duration: number; url: string } | { state: "missing"; url: string };

export function SoundTest() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const dev = useSyncExternalStore(noop, devModeOn, () => false);
  if (!mounted) return null;
  if (!dev) {
    return (
      <Screen dim="soft">
        <p className="panel px-6 py-4 text-center text-lg font-bold">Nur im Entwicklermodus (einmal mit ?dev=1 öffnen).</p>
      </Screen>
    );
  }
  return <SoundBoard />;
}

function SoundBoard() {
  const { engine, unlocked, volume } = useAudioState();
  const [status, setStatus] = useState<Partial<Record<AudioId, Status>>>({});
  const [music, setMusic] = useState<AudioId | null>(null);
  const [loops, setLoops] = useState<ReadonlySet<SurvivalLoopId>>(new Set());

  // Check every file once audio is on: loaded + decoded, or missing (404).
  useEffect(() => {
    if (!unlocked) return;
    for (const id of [...MUSIC_IDS, ...EFFECT_IDS, ...SURVIVAL_ONE_SHOT_IDS, ...SURVIVAL_LOOP_IDS]) {
      void Promise.all([engine.probe(id), engine.urlOf(id)]).then(([duration, url]) =>
        setStatus((s) => ({ ...s, [id]: duration === null ? { state: "missing", url } : { state: "ok", duration, url } })),
      );
    }
  }, [unlocked, engine]);

  // Leaving the page: nothing keeps playing.
  useEffect(
    () => () => {
      engine.playMusic(null, { fade: 0.2 });
      engine.stopLoops(0.2);
    },
    [engine],
  );

  const toggleMusic = (id: (typeof MUSIC_IDS)[number]) => {
    const next = music === id ? null : id;
    engine.playMusic(next, { fade: 0.3 });
    setMusic(next);
  };
  const toggleLoop = (id: SurvivalLoopId) => {
    const on = !loops.has(id);
    engine.setLoop(id, on ? 1 : 0, 0.3);
    setLoops((l) => {
      const n = new Set(l);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  };

  return (
    <Screen dim="soft" className="gap-5">
      <h1 className="text-center text-4xl font-bold text-bulb drop-shadow-[0_4px_0_var(--color-brown)]">Soundtest</h1>
      {!unlocked ? (
        <button type="button" onClick={() => engine.unlock()} className="btn btn-primary px-6 py-3 text-lg">
          🔊 Ton aktivieren
        </button>
      ) : (
        <label className="panel flex items-center gap-3 !rounded-2xl px-4 py-3 text-sm font-bold">
          Lautstärke
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => engine.setVolume(Number(e.target.value))}
            className="w-36 accent-[var(--color-orange)]"
          />
          <span className="tabular-nums">{Math.round(volume * 100)} %</span>
        </label>
      )}
      <div className="grid w-full max-w-5xl gap-5 md:grid-cols-2">
        <Group title="Musik (Schleife, an/aus)">
          {MUSIC_IDS.map((id) => (
            <Row key={id} id={id} status={status[id]} unlocked={unlocked} active={music === id} disabled={!unlocked} label={music === id ? "■ Stopp" : "▶ Start"} onPlay={() => toggleMusic(id)} />
          ))}
        </Group>
        <Group title="Effekte (senken die Musik kurz ab)">
          {EFFECT_IDS.map((id) => (
            <Row key={id} id={id} status={status[id]} unlocked={unlocked} disabled={!unlocked} label="▶ Abspielen" onPlay={() => void engine.playEffect(id)} />
          ))}
        </Group>
        <Group title="Survival-Finale: Einzelsounds">
          {SURVIVAL_ONE_SHOT_IDS.map((id) => (
            <Row key={id} id={id} status={status[id]} unlocked={unlocked} disabled={!unlocked} label="▶ Abspielen" onPlay={() => engine.playSound(id, 0, 5_000)} />
          ))}
        </Group>
        <Group title="Survival-Finale: Schleifen (an/aus)">
          {SURVIVAL_LOOP_IDS.map((id) => (
            <Row key={id} id={id} status={status[id]} unlocked={unlocked} active={loops.has(id)} disabled={!unlocked} label={loops.has(id) ? "■ Stopp" : "▶ Start"} onPlay={() => toggleLoop(id)} />
          ))}
        </Group>
      </div>
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel flex flex-col gap-2 px-4 py-3">
      <h2 className="text-lg font-bold text-bulb">{title}</h2>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}

function Row({
  id,
  status,
  label,
  active = false,
  unlocked,
  disabled,
  onPlay,
}: {
  id: AudioId;
  status: Status | undefined;
  label: string;
  active?: boolean;
  unlocked: boolean;
  disabled: boolean;
  onPlay: () => void;
}) {
  return (
    <li className="flex items-center gap-3">
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled || status?.state === "missing"}
        className={`btn ${active ? "btn-primary" : "btn-secondary"} w-32 shrink-0 px-3 py-1.5 text-sm disabled:opacity-40`}
      >
        {label}
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm font-bold">{id}</span>
        <span className="block truncate text-xs text-cream/70">
          {!status
            ? unlocked
              ? "lädt …"
              : "–"
            : status.state === "ok"
              ? `✅ ${status.duration.toFixed(2)} s · ${status.url}`
              : `❌ fehlt oder defekt · ${status.url}`}
        </span>
      </span>
    </li>
  );
}
