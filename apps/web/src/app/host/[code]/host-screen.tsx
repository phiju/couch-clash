"use client";

import { isValidRoomCode, type ServerMessage } from "@couch-clash/shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HostFinale, HostIntro, HostPlay, HostScoreboard } from "@/components/host/game-phases";
import { HostLobby } from "@/components/host/lobby";
import { HostSetup } from "@/components/host/setup";
import { ButtonLink, ConnectionBadge, Notice, Screen } from "@/components/ui";
import { ClockContext } from "@/lib/clock";
import { hostTokenStore } from "@/lib/storage";
import { useRoom } from "@/lib/use-room";

const subscribeNoop = () => () => {};

export function HostScreen({ code }: { code: string }) {
  // Read the token on the client only (localStorage); undefined during SSR.
  const token = useSyncExternalStore(
    subscribeNoop,
    () => hostTokenStore.get(code),
    () => undefined,
  );

  if (!isValidRoomCode(code)) {
    return <HostError title="Diesen Raumcode gibt es nicht." />;
  }
  if (token === undefined) return <Screen />;
  if (token === null) {
    return (
      <HostError title="Dieser Bildschirm ist nicht der Host von diesem Raum.">
        <p className="text-xl text-white/70">
          Der Host-Zugang liegt nur im Browser, der das Spiel erstellt hat.
        </p>
      </HostError>
    );
  }
  return <HostRoom code={code} token={token} />;
}

function HostError({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Screen className="justify-center">
      <Notice title={title}>
        {children}
        <ButtonLink href="/">Neues Spiel</ButtonLink>
      </Notice>
    </Screen>
  );
}

function HostRoom({ code, token }: { code: string; token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const { state, status, fatalError, send, clockOffset } = useRoom(code, {
    hello: () => ({ type: "hello_host", hostToken: token }),
    onMessage: (msg: ServerMessage) => {
      if (msg.type === "welcome_host") setAuthFailed(false);
      if (msg.type === "error") {
        if (msg.code === "NOT_AUTHORIZED") setAuthFailed(true);
        setError(msg.message);
      }
    },
  });

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  if (fatalError) return <HostError title={fatalError.message} />;
  if (authFailed) return <HostError title="Der Host-Zugang für diesen Raum ist ungültig." />;

  const canSend = status === "open";
  let content: React.ReactNode;
  switch (state?.phase) {
    case undefined:
    case "lobby":
      content = <HostLobby room={state} send={send} canSend={canSend} />;
      break;
    case "setup":
      content = <HostSetup room={state} send={send} canSend={canSend} />;
      break;
    case "intro":
      content = <HostIntro room={state} send={send} />;
      break;
    case "play":
      content = <HostPlay room={state} send={send} />;
      break;
    case "scoreboard":
      content = <HostScoreboard room={state} send={send} />;
      break;
    case "finale":
      content = <HostFinale room={state} send={send} />;
      break;
  }

  return (
    <ClockContext.Provider value={clockOffset}>
      {content}
      {error && (
        <div className="fixed top-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-hot px-6 py-3 text-xl font-bold shadow-xl">
          {error}
        </div>
      )}
      <ConnectionBadge status={status} />
    </ClockContext.Provider>
  );
}
