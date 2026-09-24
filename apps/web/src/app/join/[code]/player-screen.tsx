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
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { PlayerGame } from "@/components/player/game-phases";
import { PhotoChooser, PhotoProgress } from "@/components/player/photo-avatar";
import { uploadPhoto } from "@/lib/api";
import { ClockContext } from "@/lib/clock";
import { AvatarBuilder } from "@/components/avatar-builder";
import { Button, ButtonLink, ConnectionBadge, Logo, Notice, Screen } from "@/components/ui";
import { playerStore, profileStore, type PlayerCredentials } from "@/lib/storage";
import { useRoom } from "@/lib/use-room";

export function PlayerScreen({ code }: { code: string }) {
  if (!isValidRoomCode(code)) {
    return (
      <Screen dim="soft" className="justify-center">
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

  // Photo avatar: the prepared photo stays only in memory (for "Nochmal").
  const [lastPhoto, setLastPhoto] = useState<Blob | null>(null);
  /** Photo chosen in the join form – uploaded right after "joined". */
  const joinPhotoRef = useRef<Blob | null>(null);
  const [photoFlow, setPhotoFlow] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const startUpload = useCallback(
    async (credentials: PlayerCredentials, photo: Blob) => {
      setLastPhoto(photo);
      setPhotoFlow(true);
      setUploadError(null);
      setUploading(true);
      const result = await uploadPhoto(code, credentials, photo);
      setUploading(false);
      if (!result.ok) setUploadError(result.error);
    },
    [code],
  );
  const { state, status, fatalError, send, clockOffset } = useRoom(code, {
    hello: () => {
      const c = playerStore.get(code);
      return c ? { type: "hello_player", playerId: c.playerId, playerSecret: c.playerSecret } : null;
    },
    onMessage: (msg: ServerMessage) => {
      switch (msg.type) {
        case "joined": {
          const joinedCreds = { playerId: msg.playerId, playerSecret: msg.playerSecret };
          playerStore.set(code, joinedCreds);
          setCreds(joinedCreds);
          setPlayerId(msg.playerId);
          setSubmitting(false);
          setView("joined");
          // Joined with the emoji avatar – the photo is transformed in the background.
          const photo = joinPhotoRef.current;
          joinPhotoRef.current = null;
          if (photo) void startUpload(joinedCreds, photo);
          break;
        }
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
            joinPhotoRef.current = null;
            setFormError(msg.message);
            setSubmitting(false);
          }
          break;
      }
    },
  });

  if (fatalError) {
    return (
      <Screen dim="soft" className="justify-center">
        <Notice title={fatalError.message}>
          <ButtonLink href="/join">Anderen Code eingeben</ButtonLink>
        </Notice>
      </Screen>
    );
  }

  if (view === "kicked") {
    return (
      <Screen dim="soft" className="justify-center">
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
      <Screen dim="soft" className="justify-center">
        <p className="panel animate-pulse px-6 py-4 text-2xl font-bold">Verbinde mit Raum {code}…</p>
        <ConnectionBadge status={status} />
      </Screen>
    );
  }

  const me = playerId ? state.players.find((p) => p.id === playerId) : undefined;

  if (view === "joined" && me) {
    const photo = me.avatar.photo;
    const inLobby = state.phase === "lobby" || state.phase === "setup";
    // Also resumes after a reload: a running job or an unconfirmed result.
    const showProgress =
      inLobby && (photoFlow || photo?.status === "pending" || (photo?.status === "ready" && !photo.accepted));
    const closeFlow = () => {
      setPhotoFlow(false);
      setUploadError(null);
    };
    const canUpload = state.photoAvatars && !!creds;
    return (
      <ClockContext.Provider value={clockOffset}>
        <PlayerGame
          room={state}
          me={me}
          sendAction={(action) => send({ type: "action", action })}
          error={actionError}
          onErrorShown={clearActionError}
          lobbyExtra={
            canUpload && !photo ? (
              <div className="w-full">
                <p className="mb-3 text-lg font-bold text-cream/85">Lust auf eine Showstar-Figur?</p>
                <PhotoChooser onConfirm={(blob) => void startUpload(creds, blob)} />
              </div>
            ) : photo && !showProgress ? (
              <button
                type="button"
                onClick={() => send({ type: "photo_reset" })}
                className="text-lg font-bold text-cream/70 underline"
              >
                Zurück zum Emoji
              </button>
            ) : null
          }
        />
        {showProgress && (
          <PhotoProgress
            me={me}
            uploading={uploading}
            uploadError={uploadError}
            onAccept={() => {
              send({ type: "photo_accept" });
              closeFlow();
            }}
            onRetry={(next) => {
              const retryPhoto = next ?? lastPhoto;
              if (creds && retryPhoto) void startUpload(creds, retryPhoto);
            }}
            hasPhotoInMemory={lastPhoto !== null}
            onEmoji={() => {
              send({ type: "photo_reset" });
              closeFlow();
            }}
            onClose={() => {
              // An earlier image is still there → keep it (starts the expressions).
              if (photo?.readyVersion != null && !photo.accepted) send({ type: "photo_accept" });
              closeFlow();
            }}
          />
        )}
        <ConnectionBadge status={status} />
      </ClockContext.Provider>
    );
  }

  if (state.phase !== "lobby") {
    return (
      <Screen dim="soft" className="justify-center">
        <Notice title="Das Spiel läuft schon." emoji="⏳">
          <p className="text-lg text-cream/70">Beitreten geht nur, solange die Lobby offen ist.</p>
        </Notice>
      </Screen>
    );
  }

  return (
    <JoinForm
      code={code}
      error={formError}
      submitting={submitting || status !== "open"}
      photoAvatars={state.photoAvatars}
      onSubmit={(profile, photo) => {
        setFormError(null);
        setSubmitting(true);
        profileStore.set(profile);
        joinPhotoRef.current = photo;
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
  photoAvatars,
  onSubmit,
  status,
}: {
  code: string;
  error: string | null;
  submitting: boolean;
  photoAvatars: boolean;
  /** `photo`: prepared photo after "Verwandeln!", null → emoji only. */
  onSubmit: (profile: Profile, photo: Blob | null) => void;
  status: "connecting" | "open" | "closed";
}) {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const trimmed = profile.name.trim();
  const submit = (photo: Blob | null) => {
    if (trimmed) onSubmit({ ...profile, name: trimmed }, photo);
  };

  return (
    <Screen dim="soft" className="max-w-lg gap-6">
      <div className="flex w-full items-center justify-between">
        <Logo className="w-28" />
        <span className="rounded-full border-2 border-bulb bg-petrol-dark/85 px-4 py-1 text-xl font-bold tracking-widest">
          {code}
        </span>
      </div>
      <form
        className="panel flex w-full flex-col gap-6 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(null);
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-lg font-bold text-cream/80">Dein Name</span>
          <input
            value={profile.name}
            onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            enterKeyHint="done"
            placeholder="z. B. Toni"
            className="w-full rounded-2xl border-4 border-bulb bg-cream px-5 py-3 text-3xl font-bold text-brown placeholder:text-brown/30 focus:ring-8 focus:ring-orange/60 focus:outline-none"
          />
        </label>
        <AvatarBuilder value={profile.avatar} onChange={(avatar) => setProfile((p) => ({ ...p, avatar }))} />
        {error && <p className="rounded-2xl bg-rust px-4 py-2 text-center text-lg font-bold">{error}</p>}
        {photoAvatars ? (
          <div className="flex flex-col gap-2">
            <p className="text-lg font-bold text-cream/80">Wie willst du aussehen?</p>
            <p className="text-base text-cream/70">
              Mit Foto wirst du zur Showstar-Figur (im Rahmen deiner Farbe). Bis sie fertig ist – oder falls es nicht
              klappt – spielst du mit deinem Emoji.
            </p>
            <PhotoChooser
              disabled={!trimmed || submitting}
              onConfirm={(photo) => submit(photo)}
              onEmoji={() => submit(null)}
            />
          </div>
        ) : (
          <Button type="submit" disabled={!trimmed || submitting} glow className="w-full py-4 text-3xl">
            Beitreten
          </Button>
        )}
      </form>
      <ConnectionBadge status={status} />
    </Screen>
  );
}
