"use client";

import type { ClientMessage, PublicRoomState } from "@couch-clash/shared";
import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore } from "react";
import { AvatarBadge } from "@/components/avatar";
import { Button, Logo, Screen } from "@/components/ui";

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
  const code = room?.code ?? "";
  const players = room?.players ?? [];
  const joinUrl = useSyncExternalStore(
    subscribeNoop,
    () => (code ? `${window.location.origin}/join/${code}` : null),
    () => null,
  );

  return (
    <Screen className="max-w-[1800px] gap-8 lg:py-12">
      <header className="flex w-full items-center justify-between">
        <Logo className="text-4xl lg:text-5xl" />
        <p className="text-xl text-white/70 lg:text-2xl">
          {players.length} {players.length === 1 ? "Spieler:in" : "Spieler:innen"}
        </p>
      </header>

      <div className="grid w-full flex-1 gap-8 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <section className="flex flex-col items-center justify-center gap-6 rounded-[2rem] bg-white/5 p-8 ring-2 ring-white/10">
          <p className="text-2xl font-bold text-white/80 lg:text-3xl">Mitspielen mit dem Code</p>
          <p className="font-mono text-8xl font-black tracking-[0.2em] text-spot lg:text-[10rem]">{code}</p>
          {joinUrl && (
            <>
              <div className="rounded-3xl bg-white p-4">
                <QRCodeSVG value={joinUrl} size={240} marginSize={0} />
              </div>
              <p className="text-center text-xl text-white/70 lg:text-2xl">
                QR-Code scannen oder <span className="font-bold text-white">{new URL(joinUrl).host}/join</span>{" "}
                öffnen
              </p>
            </>
          )}
        </section>

        <section className="flex flex-col gap-6">
          <h2 className="text-3xl font-black lg:text-5xl">
            {players.length === 0 ? "Warte auf Mitspieler:innen…" : "Wer ist dabei?"}
          </h2>

          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {players.map((player) => (
              <li
                key={player.id}
                className="relative flex animate-pop flex-col items-center gap-3 rounded-3xl bg-white/10 p-5"
              >
                <AvatarBadge avatar={player.avatar} dimmed={!player.connected} />
                <span className="max-w-full truncate text-2xl font-black lg:text-3xl">{player.name}</span>
                <span
                  className={`flex items-center gap-2 text-sm font-bold ${player.connected ? "text-cool" : "text-white/50"}`}
                >
                  <span className={`size-3 rounded-full ${player.connected ? "bg-cool" : "bg-white/40"}`} />
                  {player.connected ? "verbunden" : "getrennt"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`${player.name} aus dem Spiel entfernen?`)) {
                      send({ type: "kick", playerId: player.id });
                    }
                  }}
                  className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-black/40 text-lg font-bold text-white/70 transition hover:bg-hot hover:text-white"
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
                  className="flex aspect-[4/5] items-center justify-center rounded-3xl border-4 border-dashed border-white/15 text-5xl text-white/20"
                >
                  ?
                </li>
              ))}
          </ul>

          <div className="mt-auto flex flex-col items-center gap-3 lg:items-end">
            <Button
              onClick={() => send({ type: "start" })}
              disabled={players.length === 0 || !canSend}
              className="px-12 py-6 text-4xl"
            >
              Spiel starten
            </Button>
          </div>
        </section>
      </div>
    </Screen>
  );
}
