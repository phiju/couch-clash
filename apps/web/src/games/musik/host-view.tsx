"use client";

import type { MusikPublicState } from "@couch-clash/games/meta";
import type { PublicRoomState } from "@couch-clash/shared";
import { useEffect, useRef } from "react";
import { AvatarBadge } from "@/components/avatar";
import { getAudioEngine } from "@/lib/audio/engine";
import { useServerNow } from "@/lib/clock";
import { Countdown, QuestionLeaderboard } from "../question-round/components";
import { QUIZ_OPTION_STYLES } from "../quiz/options";
import type { HostViewProps } from "../types";
import { clipPosition, currentBuzzPoints, pointsLabel, songTarget, timelineTicks, yearTimeline } from "./logic";
import { getSongPlayer } from "./song-player";

export function MusikHostView({ state, room }: HostViewProps<MusikPublicState>) {
  useSongPlayback(state);
  useWrongSound(state);

  if (state.step === "leaderboard") {
    return <QuestionLeaderboard state={{ index: state.index, total: state.total, answeredPlayerIds: [] }} room={room} variant="tv" />;
  }
  if (state.step === "loading") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-[2vh] text-center">
        <Equalizer />
        <p className="fs-title font-bold text-bulb">Die Platten werden aufgelegt …</p>
      </div>
    );
  }
  if (state.step === "announce") return <Announce state={state} />;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-[2vh]">
      <div className="flex shrink-0 items-center justify-between gap-[1.5vw]">
        <span className="fs-md shrink-0 rounded-full border-2 border-bulb bg-petrol-dark/85 px-4 py-[0.6vh] font-bold whitespace-nowrap">
          Song {state.index + 1} / {state.total}
        </span>
        <span className="fs-md shrink-0 rounded-full chip px-4 py-[0.6vh] font-bold whitespace-nowrap">
          {state.typeInfo.emoji} {state.typeInfo.label}
        </span>
        <div className="flex-1">
          {state.step === "play" && state.stepEndsAt !== null && state.input === "year" && (
            <Countdown startedAt={state.stepStartedAt} endsAt={state.stepEndsAt} />
          )}
          {state.step === "play" && state.input === "buzzer" && <ClipBar state={state} />}
        </div>
      </div>

      {state.reveal ? <Reveal state={state} room={room} /> : <Playing state={state} room={room} />}
    </div>
  );
}

/** Follows the server's clip on the TV's song player; preloads the next song. */
function useSongPlayback(state: MusikPublicState) {
  const now = useServerNow(250);
  const target = songTarget(state, now);
  const key = target ? `${target.url}|${target.playing}|${target.loop}|${target.level ?? 1}|${Math.round(target.positionMs / 1000)}` : "off";
  useEffect(() => {
    const player = getSongPlayer();
    if (!getAudioEngine().unlocked) return;
    if (target) player.sync(target);
    else player.stop();
    // Only the key matters (position in whole seconds is enough to catch drift).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (getAudioEngine().unlocked) getSongPlayer().preload(state.nextUrl);
  }, [state.nextUrl]);
  // Leaving the Musik-Quiz: fade out.
  useEffect(() => () => getSongPlayer().stop(), []);
}

/** A wrong buzz gets the "wrong" sound. */
function useWrongSound(state: MusikPublicState) {
  const last = useRef<number | null>(state.lastWrong?.at ?? null);
  useEffect(() => {
    const at = state.lastWrong?.at ?? null;
    if (at !== null && at !== last.current) getAudioEngine().playSound("survival-wrong", 0, 300, 0.6);
    last.current = at;
  }, [state.lastWrong?.at]);
}

/** The question type, big, 2–3 s before the song. */
function Announce({ state }: { state: MusikPublicState }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[3vh] text-center">
      <p className="fs-lg font-bold text-cream/70">
        Song {state.index + 1} von {state.total}
      </p>
      <div key={state.index} className="animate-mq-announce flex flex-col items-center gap-[2vh] rounded-[3rem] border-4 border-orange bg-bulb px-[5vw] py-[4vh] text-brown shadow-[0_12px_0_var(--color-brown)]">
        <span className="text-[clamp(4rem,14vh,10rem)] leading-none">{state.typeInfo.emoji}</span>
        <span className="fs-hero font-bold text-balance">{state.typeInfo.label}</span>
      </div>
      <p className="fs-lg text-cream/80">{state.typeInfo.hint}</p>
    </div>
  );
}

function Equalizer({ paused = false }: { paused?: boolean }) {
  return (
    <div className="flex h-[clamp(4rem,14vh,10rem)] items-end gap-[0.6vw]" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={`w-[clamp(0.7rem,1.4vw,1.6rem)] origin-bottom rounded-t-lg bg-gradient-to-t from-orange to-bulb ${paused ? "scale-y-[0.2]" : "animate-mq-bar"}`}
          style={{ height: "100%", animationDelay: `${(i * 137) % 900}ms`, animationDuration: `${700 + ((i * 211) % 500)}ms` }}
        />
      ))}
    </div>
  );
}

/** How far the clip is, and what a buzz is worth right now. */
function ClipBar({ state }: { state: MusikPublicState }) {
  const now = useServerNow(200);
  if (!state.clip) return null;
  const position = clipPosition(state.clip, now);
  const share = Math.min(1, position / state.clip.lengthMs);
  return (
    <div className="flex items-center gap-[1vw]">
      <div className="h-[clamp(0.9rem,2.4vh,1.75rem)] flex-1 overflow-hidden rounded-full border-2 border-bulb/60 bg-petrol-dark/80">
        <div className="h-full rounded-full bg-gradient-to-r from-orange to-bulb transition-[width] duration-200 ease-linear" style={{ width: `${share * 100}%` }} />
      </div>
      <span className="fs-title font-bold whitespace-nowrap text-bulb tabular-nums">{currentBuzzPoints(state.buzzRule, position)} P</span>
    </div>
  );
}

function Playing({ state, room }: { state: MusikPublicState; room: PublicRoomState }) {
  const now = useServerNow(500);
  const buzzing = state.buzz ? room.players.find((p) => p.id === state.buzz!.playerId) : undefined;
  const wrong = state.lastWrong && now - state.lastWrong.at < 3_500 ? state.lastWrong : null;
  const wrongPlayer = wrong ? room.players.find((p) => p.id === wrong.playerId) : undefined;

  return (
    <div className="grid min-h-0 flex-1 items-center gap-[2vw] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col items-center justify-center gap-[3vh]">
        {buzzing && state.buzz ? (
          <div className="flex animate-pop flex-col items-center gap-[2vh] text-center">
            <AvatarBadge avatar={buzzing.avatar} size="lg" expression="geschockt" />
            <p className="fs-title font-bold text-bulb">{buzzing.name} hat gebuzzert!</p>
            <p className="fs-lg text-cream/80">{state.step === "checking" ? "Moment, ich prüfe das …" : "Antwort wird eingetippt …"}</p>
            {state.step === "answer" && (
              <div className="w-[min(40vw,32rem)]">
                <Countdown startedAt={state.stepStartedAt} endsAt={state.buzz.endsAt} />
              </div>
            )}
          </div>
        ) : state.shown ? (
          <div className="flex flex-col items-center gap-[1.5vh] text-center">
            <Equalizer />
            <p className="fs-hero font-bold text-balance text-bulb">{state.shown.title}</p>
            <p className="fs-title font-bold text-cream/90">{state.shown.artist}</p>
            <p className="fs-lg text-cream/70">Aus welchem Jahr? Tippt es auf eurem Handy!</p>
          </div>
        ) : state.choices ? (
          <div className="flex w-full flex-col items-center gap-[2vh]">
            <Equalizer />
            <ul className="grid w-full grid-cols-2 gap-[1.5vh]">
              {state.choices.map((c, i) => {
                const style = QUIZ_OPTION_STYLES[i]!;
                return (
                  <li key={i} className={`fs-xl flex items-center gap-[0.8vw] rounded-2xl border-4 border-bulb px-[1vw] py-[1.5vh] font-bold ${style.bg} ${style.shadow}`}>
                    <span className="opacity-80">{style.shape}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{c}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-[2vh] text-center">
            <Equalizer paused={state.clip?.pausedAt !== null && state.clip?.pausedAt !== undefined} />
            <p className="fs-hero font-bold text-bulb">{state.type === "artist" ? "Wer singt das?" : "Wie heißt der Song?"}</p>
            <p className="fs-lg text-cream/80">Wer es weiß: BUZZERN!</p>
          </div>
        )}
        {wrong && wrongPlayer && (
          <p key={wrong.at} className="fs-lg animate-pop rounded-2xl bg-rust px-[1.5vw] py-[1vh] font-bold">
            ❌ {wrongPlayer.name}: {wrong.answer ? `„${wrong.answer}“` : "keine Antwort"}
          </p>
        )}
      </div>
      <PlayerStrip state={state} room={room} />
    </div>
  );
}

/** Everyone with their status – locked out, or (year / Kids) a check mark once answered. Never what. */
function PlayerStrip({ state, room }: { state: MusikPublicState; room: PublicRoomState }) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  return (
    <ul className="grid min-h-0 content-start gap-[1vh] overflow-y-auto sm:grid-cols-2">
      {room.players.map((p) => {
        const run = byId.get(p.id);
        const buzzing = state.buzz?.playerId === p.id;
        return (
          <li key={p.id} className={`flex items-center gap-[0.8vw] rounded-2xl chip px-[1vw] py-[0.8vh] ${run?.lockedOut ? "opacity-50" : ""} ${buzzing ? "ring-4 ring-orange" : ""}`}>
            <span className={run?.answered ? "animate-pop" : ""}>
              <AvatarBadge
                avatar={p.avatar}
                size="fluidSm"
                offline={!p.connected}
                dimmed={run?.lockedOut}
                expression={run?.lockedOut ? "enttaeuscht" : "neutral"}
              />
            </span>
            <span className="fs-md min-w-0 flex-1 truncate font-bold">{p.name}</span>
            {run?.lockedOut && <span className="fs-lg" aria-label="gesperrt">❌</span>}
            {run?.answered && <span className="fs-lg" aria-label="hat getippt">✅</span>}
            {buzzing && <span className="fs-lg" aria-label="antwortet">🔔</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Reveal({ state, room }: { state: MusikPublicState; room: PublicRoomState }) {
  const reveal = state.reveal!;
  const results = room.players.flatMap((p) => {
    const r = reveal.results[p.id];
    return r ? [{ player: p, result: r }] : [];
  });
  return (
    <div className="grid min-h-0 flex-1 items-center gap-[2vw] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 animate-pop items-center gap-[2vw] rounded-[2rem] border-4 border-orange bg-bulb p-[2.5vh] text-brown shadow-[0_8px_0_var(--color-brown)]">
        {reveal.coverUrl ? (
          // Cover art comes from the song provider's CDN.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reveal.coverUrl} alt="" className="aspect-square h-[min(30vh,16vw)] shrink-0 rounded-2xl object-cover shadow-lg" />
        ) : (
          <div className="flex aspect-square h-[min(30vh,16vw)] shrink-0 items-center justify-center rounded-2xl bg-brown/15 text-[clamp(4rem,12vh,8rem)]">💿</div>
        )}
        <div className="flex min-w-0 flex-col gap-[1vh]">
          <p className="fs-title leading-tight font-bold text-balance [overflow-wrap:anywhere]">{reveal.title}</p>
          <p className="fs-lg font-bold">{reveal.artist}</p>
          {reveal.year && <p className="fs-lg font-bold text-brown/70">{reveal.year}</p>}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-[2vh]">
        {state.type === "year" && reveal.year ? <Timeline reveal={reveal} room={room} /> : null}
        <ul className="grid min-h-0 content-start gap-[1vh] overflow-y-auto sm:grid-cols-2">
          {results.map(({ player, result }) => (
            <li key={player.id} className="flex items-center gap-[0.8vw] rounded-2xl chip px-[1vw] py-[0.8vh]">
              <AvatarBadge avatar={player.avatar} size="fluidSm" expression={result.points > 0 ? "jubelnd" : result.answer ? "enttaeuscht" : "neutral"} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="fs-md truncate font-bold">{player.name}</span>
                <span className="fs-sm truncate text-cream/70">
                  {result.answer ?? "–"}
                  {result.partial ? " (Bandmitglied)" : ""}
                  {reveal.closest.includes(player.id) ? " · am nächsten dran!" : ""}
                </span>
              </div>
              <span className={`fs-lg font-bold ${result.points > 0 ? "text-bulb" : result.points < 0 ? "text-orange" : "text-cream/40"}`}>
                {pointsLabel(result.points)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Everyone's year tip on a line, the right year drops in. */
function Timeline({ reveal, room }: { reveal: NonNullable<MusikPublicState["reveal"]>; room: PublicRoomState }) {
  const year = reveal.year!;
  const { from, to, marks, x } = yearTimeline(reveal.yearTips, year);
  const byId = new Map(room.players.map((p) => [p.id, p]));
  return (
    <div className="panel relative h-[clamp(9rem,26vh,16rem)] px-[3vw] pt-[2vh]">
      <div className="relative h-full">
        {/* the axis */}
        <div className="absolute right-0 bottom-[2.2rem] left-0 h-1 rounded bg-cream/60" />
        {timelineTicks(from, to).map((t) => (
          <span key={t} className="fs-sm absolute bottom-0 -translate-x-1/2 text-cream/70 tabular-nums" style={{ left: `${x(t)}%` }}>
            {t}
          </span>
        ))}
        {/* the tips */}
        {marks.map((m) => {
          const p = byId.get(m.playerId);
          if (!p) return null;
          return (
            <span key={m.playerId} className="absolute -translate-x-1/2 animate-pop" style={{ left: `${m.x}%`, bottom: `calc(2.6rem + ${m.row * 2.8}rem)` }} title={`${p.name}: ${m.year}`}>
              <AvatarBadge avatar={p.avatar} size="xs" />
            </span>
          );
        })}
        {/* the right year */}
        <div className="animate-mq-drop absolute top-0 bottom-[2.2rem] flex flex-col items-center" style={{ left: `${x(year)}%` }}>
          <span className="fs-md rounded-full bg-orange px-3 font-bold text-brown shadow">{year}</span>
          <span className="w-1 flex-1 bg-orange" />
        </div>
      </div>
    </div>
  );
}
