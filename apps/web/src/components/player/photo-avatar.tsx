"use client";

import { SAVED_AVATAR_RETENTION_DAYS, type PublicPlayer } from "@couch-clash/shared";
import { useEffect, useRef, useState } from "react";
import { AvatarBadge } from "@/components/avatar";
import { Sparkle } from "@/components/sparkle";
import { Button } from "@/components/ui";
import { preparePhoto } from "@/lib/photo";
import { photoConsentStore } from "@/lib/storage";

type Source = "selfie" | "file";

export const PHOTO_CONSENT_TEXT =
  "Dein Foto wird zur Umwandlung an OpenAI geschickt und danach sofort gelöscht. Deine Figur wird nach 24 Stunden gelöscht.";
/** Shown next to the opt-in "Figur behalten". */
export const KEEP_FIGURE_TEXT = `Nur dieses Handy kennt sie. Du kannst sie jederzeit löschen, sonst verschwindet sie nach ${SAVED_AVATAR_RETENTION_DAYS} Tagen ohne Spiel.`;

/**
 * "📸 Selfie machen" / "🖼️ Foto wählen" (/ "😀 Emoji nehmen"), the one-time
 * consent note, and the preview with "Nochmal" / "Verwandeln!".
 * Nothing leaves the phone before "Verwandeln!".
 */
export function PhotoChooser({
  onConfirm,
  onEmoji,
  disabled = false,
  disabledHint,
}: {
  onConfirm: (photo: Blob) => void;
  /** Shows the "😀 Emoji nehmen" button. */
  onEmoji?: () => void;
  disabled?: boolean;
  /** Why the buttons are disabled, shown above them (e.g. "Erst Namen eingeben"). */
  disabledHint?: string;
}) {
  const selfieRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [askConsent, setAskConsent] = useState<Source | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string; source: Source } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Free the preview image when it is replaced or the chooser closes.
  useEffect(() => {
    if (!preview) return;
    const url = preview.url;
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  const open = (source: Source) => {
    setError(null);
    (source === "selfie" ? selfieRef : fileRef).current?.click();
  };

  const choose = (source: Source) => {
    if (photoConsentStore.get()) open(source);
    else setAskConsent(source);
  };

  const onFile = async (source: Source, file: File | undefined) => {
    if (!file) return;
    setPreparing(true);
    try {
      const blob = await preparePhoto(file);
      setPreview({ blob, url: URL.createObjectURL(blob), source });
    } catch {
      setError("Dieses Bild konnte nicht geöffnet werden. Probier ein anderes.");
    } finally {
      setPreparing(false);
    }
  };

  const input = (source: Source) => (
    <input
      ref={source === "selfie" ? selfieRef : fileRef}
      type="file"
      accept="image/*"
      capture={source === "selfie" ? "user" : undefined}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = ""; // allow picking the same file again
        void onFile(source, file);
      }}
    />
  );

  return (
    <div className="flex w-full flex-col gap-3">
      {input("selfie")}
      {input("file")}
      {disabled && disabledHint && <DisabledHint text={disabledHint} />}
      <Button type="button" onClick={() => choose("selfie")} disabled={disabled || preparing} glow className="w-full py-4 text-2xl">
        📸 Selfie machen
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => choose("file")}
        disabled={disabled || preparing}
        className="w-full py-4 text-2xl"
      >
        🖼️ Foto wählen
      </Button>
      {onEmoji && (
        <Button type="button" variant="secondary" onClick={onEmoji} disabled={disabled} className="w-full py-4 text-2xl">
          😀 Emoji nehmen
        </Button>
      )}
      {preparing && <p className="text-center text-lg font-bold text-cream/80">Foto wird vorbereitet …</p>}
      {error && <p className="rounded-2xl bg-rust px-4 py-2 text-center text-lg font-bold">{error}</p>}

      {askConsent && (
        <Overlay>
          <p className="text-5xl">📸</p>
          <p className="text-xl leading-snug font-bold">{PHOTO_CONSENT_TEXT}</p>
          <Button
            type="button"
            onClick={() => {
              photoConsentStore.set();
              const source = askConsent;
              setAskConsent(null);
              open(source); // still inside the tap → the picker may open
            }}
            className="w-full"
          >
            Okay
          </Button>
          <button type="button" onClick={() => setAskConsent(null)} className="text-lg font-bold text-cream/70 underline">
            Abbrechen
          </button>
        </Overlay>
      )}

      {preview && (
        <Overlay>
          <p className="text-2xl font-bold">So sieht dein Foto aus</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
          <img src={preview.url} alt="Dein Foto" className="aspect-square w-64 max-w-full rounded-full object-cover ring-4 ring-bulb" />
          <div className="grid w-full grid-cols-2 gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const source = preview.source;
                setPreview(null);
                open(source);
              }}
              className="!px-3"
            >
              Nochmal
            </Button>
            <Button
              type="button"
              glow
              onClick={() => {
                const blob = preview.blob;
                setPreview(null);
                onConfirm(blob);
              }}
              className="!px-3"
            >
              Verwandeln!
            </Button>
          </div>
          <button type="button" onClick={() => setPreview(null)} className="text-lg font-bold text-cream/70 underline">
            Abbrechen
          </button>
        </Overlay>
      )}
    </div>
  );
}

/** Friendly reason next to disabled buttons (instead of just greying them out). */
export function DisabledHint({ text }: { text: string }) {
  return (
    <p role="status" className="rounded-full bg-bulb/15 px-4 py-1.5 text-center text-base font-bold text-bulb">
      ☝️ {text}
    </p>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-petrol-dark/80 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="panel flex w-full max-w-md animate-pop flex-col items-center gap-5 p-6 text-center">
        {children}
      </div>
    </div>
  );
}

const FAILURE_TEXT = {
  refused: "Aus diesem Foto konnten wir leider keine Figur zaubern. Probier ein anderes!",
  timeout: "Die Verwandlung hat zu lange gedauert.",
  error: "Bei der Verwandlung ist etwas schiefgelaufen.",
} as const;

/**
 * Screens after "Verwandeln!": waiting (spotlight), result ("Passt!" /
 * "Nochmal"), or a friendly error. The player is already in the game with
 * the emoji avatar – nothing here blocks the game.
 */
export function PhotoProgress({
  me,
  uploading,
  uploadError,
  onAccept,
  onRetry,
  hasPhotoInMemory,
  onEmoji,
  onClose,
}: {
  me: PublicPlayer;
  uploading: boolean;
  uploadError: string | null;
  /** "Passt!" – `keep`: also save the figure for next time. */
  onAccept: (keep: boolean) => void;
  /** Upload again: a new photo, or (no argument) the one still in memory. */
  onRetry: (photo?: Blob) => void;
  /** False after a reload – "Nochmal" then asks for a new photo. */
  hasPhotoInMemory: boolean;
  onEmoji: () => void;
  onClose: () => void;
}) {
  const photo = me.avatar.photo;
  const [choosing, setChoosing] = useState(false);
  const [keep, setKeep] = useState(false);
  const retriesLeft = photo?.regenerationsLeft ?? 0;

  if (choosing) {
    return (
      <Overlay>
        <p className="text-2xl font-bold">Neues Foto</p>
        <PhotoChooser
          onConfirm={(blob) => {
            setChoosing(false);
            onRetry(blob);
          }}
        />
        <button type="button" onClick={() => setChoosing(false)} className="text-lg font-bold text-cream/70 underline">
          Abbrechen
        </button>
      </Overlay>
    );
  }

  if (uploadError) {
    return (
      <Overlay>
        <p className="text-5xl">🙈</p>
        <p className="text-xl font-bold">{uploadError}</p>
        <p className="text-lg text-cream/80">Du spielst mit deinem Emoji weiter.</p>
        <AvatarBadge avatar={me.avatar} size="md" />
        <Button type="button" onClick={onClose} className="w-full">
          Okay
        </Button>
      </Overlay>
    );
  }

  if (uploading || photo?.status === "pending") {
    return (
      <Overlay>
        <div className="spotlight w-48">
          <AvatarBadge avatar={{ character: me.avatar.character, color: me.avatar.color }} size="lg" className="relative animate-float" />
        </div>
        <p className="text-2xl leading-snug font-bold">Du wirst gerade in einen Showstar verwandelt …</p>
        <p className="text-lg text-cream/80">
          Das dauert bis zu einer Minute. Du bist schon dabei – bis dahin spielst du mit deinem Emoji.
        </p>
      </Overlay>
    );
  }

  if (photo?.status === "ready" && !photo.accepted) {
    return (
      <Overlay>
        <p className="text-2xl font-bold text-bulb">Tadaa! ✨</p>
        <div className="relative">
          <AvatarBadge avatar={me.avatar} size="lg" className="!size-56 animate-pop" />
          <Sparkle />
        </div>
        <div className="grid w-full grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={retriesLeft === 0}
            onClick={() => (hasPhotoInMemory ? onRetry() : setChoosing(true))}
            className="!px-3"
          >
            Nochmal
          </Button>
          <Button type="button" glow onClick={() => onAccept(keep)} className="!px-3">
            Passt!
          </Button>
        </div>
        <KeepFigureToggle checked={keep} onChange={setKeep} />
        <p className="text-base text-cream/70">
          {retriesLeft === 0 ? "Keine Versuche mehr übrig." : `Noch ${retriesLeft} ${retriesLeft === 1 ? "Versuch" : "Versuche"} übrig.`}
        </p>
        <button type="button" onClick={onEmoji} className="text-lg font-bold text-cream/70 underline">
          Doch lieber mein Emoji
        </button>
      </Overlay>
    );
  }

  if (photo?.status === "failed") {
    const keepsOld = photo.readyVersion !== null;
    return (
      <Overlay>
        <p className="text-5xl">🙈</p>
        <p className="text-xl font-bold">{FAILURE_TEXT[photo.reason ?? "error"]}</p>
        <p className="text-lg text-cream/80">
          {keepsOld ? "Du behältst deine bisherige Figur." : "Du spielst mit deinem Emoji weiter."}
        </p>
        <AvatarBadge avatar={me.avatar} size="md" />
        <div className="grid w-full grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={retriesLeft === 0}
            // A refused photo would be refused again → ask for another one.
            onClick={() => (hasPhotoInMemory && photo.reason !== "refused" ? onRetry() : setChoosing(true))}
            className="!px-3"
          >
            Nochmal
          </Button>
          <Button type="button" onClick={onClose} className="!px-3">
            Okay
          </Button>
        </div>
      </Overlay>
    );
  }

  return null;
}

/** Opt-in "⭐ Figur fürs nächste Mal behalten". */
export function KeepFigureToggle({ checked, onChange }: { checked: boolean; onChange: (keep: boolean) => void }) {
  return (
    <label className="flex w-full cursor-pointer items-start gap-3 rounded-2xl border-2 border-bulb/50 bg-petrol/50 p-3 text-left">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-6 shrink-0 accent-orange"
      />
      <span>
        <span className="block text-lg font-bold">⭐ Figur fürs nächste Mal behalten</span>
        <span className="block text-sm text-cream/75">{KEEP_FIGURE_TEXT}</span>
      </span>
    </label>
  );
}

/**
 * "⭐ Meine Figur nehmen" with a preview of the saved figure. Hides itself
 * (and forgets the id) if the figure no longer exists.
 */
export function SavedFigureChoice({
  previewUrl,
  onUse,
  onDelete,
  onGone,
  disabled = false,
}: {
  previewUrl: string;
  onUse: () => void;
  onDelete: () => void;
  onGone: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-full items-center gap-4 rounded-3xl border-2 border-bulb bg-petrol/60 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the party worker */}
      <img
        src={previewUrl}
        alt="Deine gespeicherte Figur"
        onError={onGone}
        className="size-20 shrink-0 rounded-full bg-cream object-cover ring-4 ring-bulb"
      />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <Button type="button" glow disabled={disabled} onClick={onUse} className="w-full !px-3 !py-3 !text-xl">
          ⭐ Meine Figur nehmen
        </Button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Deine gespeicherte Figur löschen?")) onDelete();
          }}
          className="text-base font-bold text-cream/70 underline"
        >
          Figur löschen
        </button>
      </div>
    </div>
  );
}
