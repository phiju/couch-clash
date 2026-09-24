"use client";

import {
  AvatarSchema,
  NAME_MAX_LENGTH,
  isValidRoomCode,
  randomAvatar,
  secureRandomInt,
  type Avatar,
  type ServerMessage,
} from "@couch-clash/shared";
import { useCallback, useState, useSyncExternalStore } from "react";
import { PlayerGame } from "@/components/player/game-phases";
import { ClockContext } from "@/lib/clock";
import { AvatarBuilder } from "@/components/avatar-builder";
import { Button, ButtonLink, ConnectionBadge, Logo, Notice, Screen } from "@/components/ui";
import { playerStore, profileStore, type PlayerCredentials } from "@/lib/storage";
import { useRoom } from "@/lib/use-room";

export function PlayerScreen({ code }: { code: string }) {
  if (!isValidRoomCode(code)) {
    return (
      <Screen className="justify-center">
        <Notice title="Diesen Raumcode gibt es nicht.">
          <ButtonLink href="/join">Code eingeben</ButtonLink>
        </Notice>
      </Screen>
    );
  }
  return <ClientOnly>{<PlayerRoom code={code} />}</ClientOnly>;
}

const subscribeNoop = () => () => {};

/** PlayerRoom reads localStorage in its initial state, so it must not render during SSR. */
function ClientOnly({ children }: { children: React.ReactNode }) {
  const isClient = useSyncExternalStore(subscribeNoop, () => true, () => false);
  return isClient ? children : <Screen />;
}

/**
 * - "restoring": we have stored credentials and wait for the server to confirm
 * - "form": name + avatar
 * - "joined": waiting screen
 * - "kicked": removed by the host
 */
type View = "restoring" | "form" | "joined" | "kicked";

interface Profile {
  name: string;
  avatar: Avatar;
}

function loadProfile(): Profile {
  const stored = profileStore.get<Profile>();
  const avatar = AvatarSchema.safeParse(stored?.avatar);
  return {
    name: typeof stored?.name === "string" ? stored.name.slice(0, NAME_MAX_LENGTH) : "",
    avatar: avatar.success ? avatar.data : randomAvatar(secureRandomInt),
  };
}

function PlayerRoom({ code }: { code: string }) {
  // Client-only (see ClientOnly), so localStorage can be read during the first render.
  const [creds, setCreds] = useState<PlayerCredentials | null>(() => playerStore.get(code));
  const [view, setView] = useState<View>(() => (creds ? "restoring" : "form"));
  const [playerId, setPlayerId] = useState<string | null>(creds?.playerId ?? null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const clearActionError = useCallback(() => setActionError(null), []);
  const { state, status, fatalError, send, clockOffset } = useRoom(code, {
    hello: () => {
      const c = playerStore.get(code);
      return c ? { type: "hello_player", playerId: c.playerId, playerSecret: c.playerSecret } : null;
    },
    onMessage: (msg: ServerMessage) => {
      switch (msg.type) {
        case "joined":
          playerStore.set(code, { playerId: msg.playerId, playerSecret: msg.playerSecret });
          setCreds({ playerId: msg.playerId, playerSecret: msg.playerSecret });
          setPlayerId(msg.playerId);
          setSubmitting(false);
          setView("joined");
          break;
        case "welcome_player":
          setPlayerId(msg.playerId);
          setView("joined");
          break;
        case "kicked":
          playerStore.clear(code);
          setCreds(null);
          setPlayerId(null);
          setView("kicked");
          break;
        case "error":
          if (msg.code === "UNKNOWN_PLAYER") {
            // Stored credentials are stale (e.g. removed while offline).
            playerStore.clear(code);
            setCreds(null);
            setPlayerId(null);
            setView("form");
          } else if (view === "joined") {
            setActionError(msg.message);
          } else {
            setFormError(msg.message);
            setSubmitting(false);
          }
          break;
      }
    },
  });

  if (fatalError) {
    return (
      <Screen className="justify-center">
        <Notice title={fatalError.message}>
          <ButtonLink href="/join">Anderen Code eingeben</ButtonLink>
        </Notice>
      </Screen>
    );
  }

  if (view === "kicked") {
    return (
      <Screen className="justify-center">
        <Notice title="Der Host hat dich aus dem Spiel entfernt." emoji="👋">
          {state?.phase === "lobby" && (
            <Button onClick={() => setView("form")}>Nochmal beitreten</Button>
          )}
        </Notice>
      </Screen>
    );
  }

  if (view === "restoring" || !state) {
    return (
      <Screen className="justify-center">
        <p className="animate-pulse text-2xl font-bold">Verbinde mit Raum {code}…</p>
        <ConnectionBadge status={status} />
      </Screen>
    );
  }

  const me = playerId ? state.players.find((p) => p.id === playerId) : undefined;

  if (view === "joined" && me) {
    return (
      <ClockContext.Provider value={clockOffset}>
        <PlayerGame
          room={state}
          me={me}
          sendAction={(action) => send({ type: "action", action })}
          error={actionError}
          onErrorShown={clearActionError}
        />
        <ConnectionBadge status={status} />
      </ClockContext.Provider>
    );
  }

  if (state.phase !== "lobby") {
    return (
      <Screen className="justify-center">
        <Notice title="Das Spiel läuft schon." emoji="⏳">
          <p className="text-lg text-white/70">Beitreten geht nur, solange die Lobby offen ist.</p>
        </Notice>
      </Screen>
    );
  }

  return (
    <JoinForm
      code={code}
      error={formError}
      submitting={submitting || status !== "open"}
      onSubmit={(profile) => {
        setFormError(null);
        setSubmitting(true);
        profileStore.set(profile);
        send({ type: "join", name: profile.name, avatar: profile.avatar });
      }}
      status={status}
    />
  );
}

function JoinForm({
  code,
  error,
  submitting,
  onSubmit,
  status,
}: {
  code: string;
  error: string | null;
  submitting: boolean;
  onSubmit: (profile: Profile) => void;
  status: "connecting" | "open" | "closed";
}) {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const trimmed = profile.name.trim();

  return (
    <Screen className="max-w-lg gap-6">
      <div className="flex w-full items-center justify-between">
        <Logo className="text-3xl" />
        <span className="rounded-full bg-white/10 px-4 py-1 font-mono text-xl font-black tracking-widest">
          {code}
        </span>
      </div>
      <form
        className="flex w-full flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSubmit({ ...profile, name: trimmed });
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-lg font-bold text-white/80">Dein Name</span>
          <input
            value={profile.name}
            onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            enterKeyHint="done"
            placeholder="z. B. Toni"
            className="w-full rounded-2xl bg-white px-5 py-4 text-3xl font-black text-stage placeholder:text-stage/30 focus:ring-8 focus:ring-spot focus:outline-none"
          />
        </label>
        <AvatarBuilder value={profile.avatar} onChange={(avatar) => setProfile((p) => ({ ...p, avatar }))} />
        {error && <p className="text-center text-lg font-bold text-hot">{error}</p>}
        <Button type="submit" disabled={!trimmed || submitting} className="sticky bottom-4 w-full py-5 text-3xl">
          Beitreten
        </Button>
      </form>
      <ConnectionBadge status={status} />
    </Screen>
  );
}
