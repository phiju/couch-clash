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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PlayerGame } from "@/components/player/game-phases";
import { DisabledHint, PhotoChooser, PhotoProgress, SavedFigureChoice } from "@/components/player/photo-avatar";
import { deleteSavedFigure, savedFigureUrl, uploadPhoto } from "@/lib/api";
import { ClockContext } from "@/lib/clock";
import { AvatarBuilder } from "@/components/avatar-builder";
import { Button, ButtonLink, ConnectionBadge, Logo, Notice, Screen } from "@/components/ui";
import { playerStore, profileStore, savedFigureStore, type PlayerCredentials } from "@/lib/storage";
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
  /** Figure kept with "Figur behalten" (id only on this phone). */
  const [savedFigure, setSavedFigure] = useState<string | null>(() => savedFigureStore.get());
  const forgetSavedFigure = useCallback(() => {
    savedFigureStore.clear();
    setSavedFigure(null);
  }, []);

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
        case "photo_saved":
          savedFigureStore.set(msg.savedId);
          setSavedFigure(msg.savedId);
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
          if (msg.code === "PHOTO_SAVED_GONE") forgetSavedFigure();
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
          onRate={(contentId, vote) => send({ type: "rate_question", contentId, vote })}
          error={actionError}
          onErrorShown={clearActionError}
          lobbyExtra={
            canUpload && !photo ? (
              <div className="flex w-full flex-col gap-3">
                <p className="text-lg font-bold text-cream/85">Lust auf eine Showstar-Figur?</p>
                {savedFigure && (
                  <SavedFigureChoice
                    previewUrl={savedFigureUrl(savedFigure)}
                    onUse={() => send({ type: "photo_use_saved", savedId: savedFigure })}
                    onDelete={() => {
                      void deleteSavedFigure(savedFigure);
                      forgetSavedFigure();
                    }}
                    onGone={forgetSavedFigure}
                  />
                )}
                <PhotoChooser onConfirm={(blob) => void startUpload(creds, blob)} />
              </div>
            ) : photo && !showProgress ? (
              <div className="flex flex-col items-center gap-3">
                {photo.accepted && photo.readyVersion !== null && inLobby && !photo.saved && (
                  <Button type="button" variant="secondary" onClick={() => send({ type: "photo_save" })} className="!text-xl">
                    ⭐ Figur fürs nächste Mal behalten
                  </Button>
                )}
                {photo.saved && <p className="text-lg font-bold text-bulb">⭐ Für nächstes Mal gespeichert</p>}
                <button
                  type="button"
                  onClick={() => send({ type: "photo_reset" })}
                  className="text-lg font-bold text-cream/70 underline"
                >
                  Zurück zum Emoji
                </button>
              </div>
            ) : null
          }
        />
        {showProgress && (
          <PhotoProgress
            me={me}
            uploading={uploading}
            uploadError={uploadError}
            onAccept={(keep) => {
              send({ type: "photo_accept" });
              if (keep) send({ type: "photo_save" });
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
      savedFigure={state.photoAvatars ? savedFigure : null}
      onDeleteSavedFigure={() => {
        if (savedFigure) void deleteSavedFigure(savedFigure);
        forgetSavedFigure();
      }}
      onSavedFigureGone={forgetSavedFigure}
      onSubmit={(profile, photo, useSaved) => {
        setFormError(null);
        setSubmitting(true);
        profileStore.set(profile);
        joinPhotoRef.current = photo;
        send({
          type: "join",
          name: profile.name,
          avatar: profile.avatar,
          ...(useSaved && savedFigure ? { savedFigureId: savedFigure } : {}),
        });
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
  savedFigure,
  onDeleteSavedFigure,
  onSavedFigureGone,
  onSubmit,
  status,
}: {
  code: string;
  error: string | null;
  submitting: boolean;
  photoAvatars: boolean;
  savedFigure: string | null;
  onDeleteSavedFigure: () => void;
  onSavedFigureGone: () => void;
  /** `photo`: prepared photo after "Verwandeln!", null → emoji only. `useSaved`: "⭐ Meine Figur". */
  onSubmit: (profile: Profile, photo: Blob | null, useSaved?: boolean) => void;
  status: "connecting" | "open" | "closed";
}) {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  // Without photo avatars the emoji builder is the only option → always open.
  const [emojiOpen, setEmojiOpen] = useState(false);
  const showEmoji = !photoAvatars || emojiOpen;
  const emojiRef = useRef<HTMLElement>(null);
  // Opened by tap → bring the builder into view (once, not on every change).
  useEffect(() => {
    if (emojiOpen) emojiRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [emojiOpen]);
  const trimmed = profile.name.trim();
  const needsName = !trimmed;
  const disabled = needsName || submitting;
  const nameHint = needsName ? "Erst Namen eingeben" : undefined;
  const setAvatar = (avatar: Avatar) => setProfile((p) => ({ ...p, avatar }));
  const submit = (photo: Blob | null, useSaved = false) => {
    if (trimmed) onSubmit({ ...profile, name: trimmed }, photo, useSaved);
  };

  return (
    <Screen dim="soft" className="max-w-lg gap-4">
      <div className="flex w-full items-center justify-between">
        <Logo className="w-24" />
        <span className="rounded-full border-2 border-bulb bg-petrol-dark/85 px-4 py-1 text-xl font-bold tracking-widest">
          {code}
        </span>
      </div>
      <form
        className="panel flex w-full flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(null);
        }}
      >
        {/* 1. Name */}
        <label className="flex flex-col gap-1.5">
          <span className="text-lg font-bold text-cream/80">Dein Name</span>
          <input
            value={profile.name}
            onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            enterKeyHint="done"
            placeholder="z. B. Toni"
            className="w-full rounded-2xl border-4 border-bulb bg-cream px-5 py-2.5 text-3xl font-bold text-brown placeholder:text-brown/30 focus:ring-8 focus:ring-orange/60 focus:outline-none"
          />
        </label>

        {/* 2. Saved figure */}
        {savedFigure && (
          <SavedFigureChoice
            previewUrl={savedFigureUrl(savedFigure)}
            disabled={disabled}
            onUse={() => submit(null, true)}
            onDelete={onDeleteSavedFigure}
            onGone={onSavedFigureGone}
          />
        )}

        {error && <p className="rounded-2xl bg-rust px-4 py-2 text-center text-lg font-bold">{error}</p>}

        {photoAvatars && (
          <>
            {/* 3. Photo first */}
            <section className="flex flex-col gap-3" aria-label="Mit Foto">
              <h2 className="text-2xl font-bold">Wie willst du aussehen?</h2>
              <PhotoChooser disabled={disabled} disabledHint={nameHint} onConfirm={(photo) => submit(photo)} />
              <p className="text-center text-base text-cream/75">Du wirst zur Showstar-Figur.</p>
              {/* The color is the ring of the photo avatar – reachable without the emoji builder. */}
              {!emojiOpen && (
                <AvatarBuilder value={profile.avatar} onChange={setAvatar} parts={["color"]} preview={false} labels={{ color: "Deine Farbe" }} />
              )}
            </section>

            {/* 4. Divider */}
            <div className="flex items-center gap-3 text-base font-bold text-cream/60" aria-hidden>
              <span className="h-0.5 flex-1 rounded bg-cream/20" />
              oder
              <span className="h-0.5 flex-1 rounded bg-cream/20" />
            </div>

            {/* 5. Emoji as the quieter alternative */}
            {!emojiOpen && (
              <button
                type="button"
                onClick={() => setEmojiOpen(true)}
                aria-expanded={false}
                className="self-center rounded-full px-4 py-2 text-xl font-bold text-cream/85 underline decoration-bulb/60 underline-offset-4 transition hover:text-cream"
              >
                😀 Lieber mit Emoji spielen
              </button>
            )}
          </>
        )}

        {showEmoji && (
          <section
            className="flex scroll-mt-4 flex-col gap-4"
            aria-label="Mit Emoji"
            ref={emojiRef}
          >
            <AvatarBuilder value={profile.avatar} onChange={setAvatar} />
            {nameHint && <DisabledHint text={nameHint} />}
            {photoAvatars ? (
              <Button type="submit" variant="secondary" disabled={disabled} className="w-full py-4 !text-2xl">
                Mit Emoji beitreten
              </Button>
            ) : (
              <Button type="submit" disabled={disabled} glow className="w-full py-4 text-3xl">
                Beitreten
              </Button>
            )}
          </section>
        )}
      </form>
      <ConnectionBadge status={status} />
    </Screen>
  );
}
