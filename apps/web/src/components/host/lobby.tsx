"use client";

import type { ClientMessage, PublicRoomState } from "@couch-clash/shared";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useSyncExternalStore } from "react";
import { AvatarBadge } from "@/components/avatar";
import { Mascot } from "@/components/mascot";
import { Sparkle } from "@/components/sparkle";
import { Button, Logo, Screen } from "@/components/ui";
import { displayJoinLink, joinUrl as buildJoinUrl } from "@/lib/config";
import { summaryText } from "@/lib/summary";
import { usePhotoCelebration } from "./photo-celebration";
import { GameSettingsPanel } from "./settings-panel";

const subscribeNoop = () => () => {};

export function HostLobby({
  room,
  send,
  canSend,
}: {
  room: PublicRoomState | null;
  send: (msg: ClientMessage) => void;
  canSend: boolean;
}) {
  const startRef = useRef<(() => void) | null>(null);
  const code = room?.code ?? "";
  const players = room?.players ?? [];
  const celebrating = usePhotoCelebration(players);
  const joinUrl = useSyncExternalStore(
    subscribeNoop,
    () => (code ? buildJoinUrl(code) : null),
    () => null,
  );

  return (
    <Screen fit className="max-w-[2400px]">
      <header className="flex w-full shrink-0 items-center justify-between pr-14">
        <Logo className="w-[clamp(6rem,min(10vw,14vh),12rem)]" />
        <p className="fs-md rounded-full chip px-5 py-2 font-bold">
          {players.length} {players.length === 1 ? "Spieler:in" : "Spieler:innen"}
        </p>
      </header>

      <div className="grid min-h-0 w-full flex-1 gap-[1.6vw] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.15fr)] roomy:grid-cols-[minmax(0,0.55fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.15fr)]">
        {/* The host stands next to the QR code – only where there is room for him. */}
        <Mascot
          pose="idle"
          message="Scannt den Code!"
          className="z-10 hidden min-h-0 self-end justify-center roomy:flex"
          imageClassName="h-[min(58vh,640px)] max-w-none"
          bubbleClassName="fs-md !bottom-[96%] !left-[10%] max-w-[16rem]"
        />

        <section className="panel @container flex min-h-0 flex-col items-center justify-center gap-[1.8vh] p-[2vh]">
          <p className="fs-lg text-center font-bold text-cream/85">Mitspielen mit dem Code</p>
          <p className="text-[min(24cqw,14vh)] leading-none font-bold tracking-[0.1em] whitespace-nowrap text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">
            {code}
          </p>
          {joinUrl && (
            <>
              <div className="aspect-square w-[min(80cqw,38vh)] shrink rounded-3xl border-4 border-bulb bg-cream p-[1.4vh]">
                <QRCodeSVG value={joinUrl} size={256} marginSize={0} style={{ width: "100%", height: "100%" }} />
              </div>
              <p className="fs-md text-center text-cream/80">
                QR-Code scannen oder öffnen:
                <br />
                <span className="font-bold whitespace-nowrap text-bulb">{displayJoinLink()}</span>
              </p>
            </>
          )}
        </section>

        <section className="panel flex min-h-0 flex-col gap-[1.8vh] p-[2vh]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 className="fs-title font-bold">
              {players.length === 0 ? "Warte auf Mitspieler:innen…" : "Wer ist dabei?"}
            </h2>
            {room && (
              <label className="fs-sm flex cursor-pointer items-center gap-2 font-bold text-cream/85">
                <input
                  type="checkbox"
                  role="switch"
                  checked={room.photoAvatars}
                  disabled={!canSend}
                  onChange={(e) => send({ type: "set_photo_avatars", enabled: e.target.checked })}
                  className="size-5 accent-orange"
                />
                📸 Foto-Avatare erlauben
              </label>
            )}
          </div>

          <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(clamp(7.5rem,11vw,12rem),1fr))] content-start gap-[1.2vh] overflow-y-auto pr-1">
            {players.map((player) => (
              <li
                key={player.id}
                className="relative flex animate-pop flex-col items-center gap-[0.8vh] rounded-3xl chip px-2 py-[1.4vh]"
              >
                <div className="relative">
                  <AvatarBadge avatar={player.avatar} size="fluid" dimmed={!player.connected} />
                  {celebrating.has(player.id) && <Sparkle />}
                  {player.avatar.photo?.status === "pending" && (
                    <span
                      className="absolute -right-2 -bottom-1 animate-pulse rounded-full bg-orange px-1.5 text-base"
                      title="Foto-Figur wird gemalt"
                    >
                      ✨
                    </span>
                  )}
                </div>
                <span className="fs-lg w-full text-center leading-tight font-bold [overflow-wrap:anywhere] text-balance">
                  {player.name}
                </span>
                <span
                  className={`fs-sm flex items-center gap-1.5 font-bold ${player.connected ? "text-bulb" : "text-cream/50"}`}
                >
                  <span className={`size-2.5 rounded-full ${player.connected ? "bg-bulb" : "bg-cream/40"}`} />
                  {player.connected ? "verbunden" : "getrennt"}
                </span>
                {player.avatar.photo && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Foto-Figur von ${player.name} löschen? (Das Emoji bleibt.)`)) {
                        send({ type: "photo_reset", playerId: player.id });
                      }
                    }}
                    className="fs-sm rounded-full bg-petrol-dark/60 px-3 font-bold text-cream/70 transition hover:bg-rust hover:text-cream"
                  >
                    ↺ Emoji
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`${player.name} aus dem Spiel entfernen?`)) {
                      send({ type: "kick", playerId: player.id });
                    }
                  }}
                  className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full bg-petrol-dark/60 text-base font-bold text-cream/70 transition hover:bg-rust hover:text-cream"
                  aria-label={`${player.name} entfernen`}
                  title="Entfernen"
                >
                  ✕
                </button>
              </li>
            ))}
            {players.length === 0 &&
              [0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="fs-title flex aspect-[4/5] max-h-[22vh] items-center justify-center rounded-3xl border-4 border-dashed border-bulb/30 text-cream/30"
                >
                  ?
                </li>
              ))}
          </ul>

          {/* Always visible – the player list scrolls instead. */}
          <div className="flex shrink-0 flex-col items-center gap-[1vh] lg:items-end">
            <p className="fs-md text-right font-bold text-cream/80">{summaryText(room?.settingsSummary ?? null)}</p>
            <Button
              onClick={() => startRef.current?.()}
              disabled={players.length === 0 || !canSend || !room?.settingsSummary}
              glow
              className="fs-xl !px-[2.2vw] !py-[1.3vh] whitespace-nowrap"
            >
              Spiel starten
            </Button>
          </div>
        </section>

        {room && (
          <section className="panel flex min-h-0 flex-col p-[2vh]">
            {/* The settings scroll inside their column. */}
            <div className="-m-1 min-h-0 flex-1 overflow-y-auto p-1">
              <GameSettingsPanel
                serverSettings={room.settings}
                send={send}
                canSend={canSend}
                startRef={startRef}
                compact
              />
            </div>
          </section>
        )}
      </div>
    </Screen>
  );
}
