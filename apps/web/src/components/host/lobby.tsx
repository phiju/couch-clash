"use client";

import type { ClientMessage, PublicRoomState } from "@couch-clash/shared";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useSyncExternalStore } from "react";
import { AvatarBadge } from "@/components/avatar";
import { Mascot } from "@/components/mascot";
import { Button, Logo, Screen } from "@/components/ui";
import { displayJoinLink, joinUrl as buildJoinUrl } from "@/lib/config";
import { summaryText } from "@/lib/summary";
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
  const joinUrl = useSyncExternalStore(
    subscribeNoop,
    () => (code ? buildJoinUrl(code) : null),
    () => null,
  );

  return (
    <Screen className="max-w-[1880px] gap-6 lg:py-8">
      <header className="flex w-full items-center justify-between">
        <Logo className="w-36 lg:w-44" />
        <p className="rounded-full chip px-5 py-2 text-xl font-bold lg:text-2xl">
          {players.length} {players.length === 1 ? "Spieler:in" : "Spieler:innen"}
        </p>
      </header>

      <div className="grid w-full flex-1 gap-6 lg:grid-cols-[minmax(300px,1fr)_1.4fr] xl:grid-cols-[14rem_minmax(320px,1fr)_1.3fr_1.2fr]">
        {/* The host stands next to the QR code (TV only). */}
        <Mascot
          pose="idle"
          message="Scannt den Code!"
          className="z-10 hidden self-end xl:flex"
          imageClassName="h-[52vh] max-h-[620px]"
          bubbleClassName="text-xl"
        />

        <section className="panel flex flex-col items-center justify-center gap-5 p-6">
          <p className="text-2xl font-bold text-cream/80 lg:text-3xl">Mitspielen mit dem Code</p>
          <p className="text-8xl font-bold tracking-[0.15em] text-bulb drop-shadow-[0_6px_0_var(--color-brown)] xl:text-9xl">
            {code}
          </p>
          {joinUrl && (
            <>
              <div className="rounded-3xl border-4 border-bulb bg-cream p-4">
                <QRCodeSVG value={joinUrl} size={220} marginSize={0} />
              </div>
              <p className="text-center text-xl text-cream/70 lg:text-2xl">
                QR-Code scannen oder <span className="font-bold text-bulb">{displayJoinLink()}</span> öffnen
              </p>
            </>
          )}
        </section>

        <section className="panel flex flex-col gap-6 p-6">
          <h2 className="text-3xl font-bold lg:text-5xl">
            {players.length === 0 ? "Warte auf Mitspieler:innen…" : "Wer ist dabei?"}
          </h2>

          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {players.map((player) => (
              <li
                key={player.id}
                className="relative flex animate-pop flex-col items-center gap-3 rounded-3xl chip p-5"
              >
                <AvatarBadge avatar={player.avatar} dimmed={!player.connected} />
                <span className="max-w-full truncate text-2xl font-bold lg:text-3xl">{player.name}</span>
                <span
                  className={`flex items-center gap-2 text-sm font-bold ${player.connected ? "text-bulb" : "text-cream/50"}`}
                >
                  <span className={`size-3 rounded-full ${player.connected ? "bg-bulb" : "bg-cream/40"}`} />
                  {player.connected ? "verbunden" : "getrennt"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`${player.name} aus dem Spiel entfernen?`)) {
                      send({ type: "kick", playerId: player.id });
                    }
                  }}
                  className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-petrol-dark/40 text-lg font-bold text-cream/70 transition hover:bg-rust hover:text-cream"
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
                  className="flex aspect-[4/5] items-center justify-center rounded-3xl border-4 border-dashed border-bulb/30 text-5xl text-cream/30"
                >
                  ?
                </li>
              ))}
          </ul>

          <div className="mt-auto flex flex-col items-center gap-3 lg:items-end">
            <p className="text-xl font-bold text-cream/70">{summaryText(room?.settingsSummary ?? null)}</p>
            <Button
              onClick={() => startRef.current?.()}
              disabled={players.length === 0 || !canSend || !room?.settingsSummary}
              glow
              className="px-12 py-5 text-4xl"
            >
              Spiel starten
            </Button>
          </div>
        </section>

        {room && (
          <section className="panel p-5 lg:col-span-2 xl:col-span-1 xl:max-h-[calc(100dvh-10rem)] xl:overflow-y-auto">
            <GameSettingsPanel
              serverSettings={room.settings}
              send={send}
              canSend={canSend}
              startRef={startRef}
              compact
            />
          </section>
        )}
      </div>
    </Screen>
  );
}
