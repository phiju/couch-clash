"use client";

import { MUSIK_GENRES } from "@couch-clash/games/meta";
import type { AdminSong, AdminSongEdit, AdminSongsResponse } from "@couch-clash/shared";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { TokenForm } from "../fragen/admin-questions";
import { AdminNav } from "@/components/admin-nav";
import { Screen } from "@/components/ui";
import { AdminApiError, adminApi, adminTokenStore, saveAdminToken } from "@/lib/admin-api";
import { DEFAULT_SONG_VIEW, filterSongs, parseAliases, yearEdit, type SongView } from "@/lib/admin-songs";

const GENRE_LABEL = Object.fromEntries(MUSIK_GENRES.map((g) => [g.id, `${g.emoji} ${g.label}`]));

export function AdminSongsPage() {
  const token = useSyncExternalStore(adminTokenStore.subscribe, adminTokenStore.get, adminTokenStore.getServer);
  const logout = useCallback((message?: string) => {
    saveAdminToken(null);
    if (message) window.alert(message);
  }, []);
  if (token === undefined) return <Screen />;
  if (!token) return <TokenForm title="Songs 🔒" onSubmit={(t) => saveAdminToken(t)} />;
  return <SongsView token={token} onLogout={logout} />;
}

function SongsView({ token, onLogout }: { token: string; onLogout: (message?: string) => void }) {
  const [data, setData] = useState<AdminSongsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<SongView>(DEFAULT_SONG_VIEW);

  useEffect(() => {
    let cancelled = false;
    adminApi.songs(token).then(
      (body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof AdminApiError && err.status === 401) return onLogout("Token ungültig.");
        setError(err instanceof Error ? err.message : "Fehler");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, onLogout, reloadKey]);

  const save = useCallback(
    async (song: AdminSong, edit: AdminSongEdit, message: string) => {
      try {
        await adminApi.editSong(token, song.id, edit);
        // Shown right away; the next load brings the stored state.
        setData((d) => d && { ...d, songs: d.songs.map((s) => (s.id === song.id ? { ...s, ...edit, edited: true } : s)) });
        setNotice(`${message} – gilt ab der nächsten Runde.`);
      } catch (err) {
        if (err instanceof AdminApiError && err.status === 401) return onLogout("Token ungültig.");
        setError(err instanceof Error ? err.message : "Fehler");
      }
    },
    [token, onLogout],
  );

  const songs = useMemo(() => (data ? filterSongs(data.songs, view) : []), [data, view]);
  const unverified = data?.songs.filter((s) => !s.yearVerified && !s.disabled).length ?? 0;

  return (
    <Screen className="max-w-[1200px] !items-stretch gap-4 text-base">
      <AdminNav />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">🎶 Songs</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="rounded-full px-3 py-1 font-bold hover:bg-petrol-dark/70">
            ↻ Neu laden
          </button>
          <button type="button" onClick={() => onLogout()} className="rounded-full px-3 py-1 text-cream/70 hover:bg-petrol-dark/70">
            Abmelden
          </button>
        </div>
      </header>

      {error && <p className="rounded-xl bg-rust px-4 py-2 font-bold">{error}</p>}
      {notice && (
        <button type="button" onClick={() => setNotice(null)} className="rounded-xl bg-petrol-dark px-4 py-2 text-left font-bold">
          ✓ {notice}
        </button>
      )}
      {!data && !error && <p className="text-cream/70">Lädt …</p>}

      {data && (
        <>
          <p className="text-cream/80">
            {data.songs.length} Songs · {unverified} ohne bestätigtes Jahr (spielen nie „Aus welchem Jahr?“) ·{" "}
            {data.importedAt ? `Import: ${new Date(data.importedAt).toLocaleString("de-DE")}` : "keine gespeicherten Songs – die Runden holen ihre Songs live von Deezer"}
          </p>
          <div className="panel flex flex-wrap items-center gap-4 !rounded-2xl p-3">
            <input
              value={view.search}
              onChange={(e) => setView((v) => ({ ...v, search: e.target.value }))}
              placeholder="Suche: Titel, Interpret, Alias"
              className="min-w-60 flex-1 rounded-xl bg-cream px-3 py-2 text-brown"
            />
            <select
              value={view.genre}
              onChange={(e) => setView((v) => ({ ...v, genre: e.target.value }))}
              className="rounded-xl bg-cream px-3 py-2 text-brown"
            >
              <option value="">Alle Genres</option>
              {MUSIK_GENRES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.emoji} {g.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={view.unverifiedOnly}
                onChange={(e) => setView((v) => ({ ...v, unverifiedOnly: e.target.checked }))}
                className="size-5 accent-[var(--color-orange)]"
              />
              Nur ohne bestätigtes Jahr
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={view.showDisabled}
                onChange={(e) => setView((v) => ({ ...v, showDisabled: e.target.checked }))}
                className="size-5 accent-[var(--color-orange)]"
              />
              Ausgeschaltete zeigen
            </label>
            <span className="text-cream/70">{songs.length} angezeigt</span>
          </div>

          <ul className="flex flex-col gap-3">
            {songs.slice(0, 300).map((song) => (
              <SongRow key={song.id} song={song} onSave={save} />
            ))}
          </ul>
          {songs.length > 300 && <p className="text-cream/70">… und {songs.length - 300} weitere – Suche oder Filter eingrenzen.</p>}
        </>
      )}
    </Screen>
  );
}

function SongRow({ song, onSave }: { song: AdminSong; onSave: (song: AdminSong, edit: AdminSongEdit, message: string) => Promise<void> }) {
  const [year, setYear] = useState(song.originalYear?.toString() ?? "");
  const [titleAliases, setTitleAliases] = useState(song.titleAliases.join(", "));
  const [artistAliases, setArtistAliases] = useState(song.artistAliases.join(", "));
  const aliasesChanged = titleAliases !== song.titleAliases.join(", ") || artistAliases !== song.artistAliases.join(", ");
  const confirm = yearEdit(year, true);
  const change = yearEdit(year, false);

  return (
    <li className={`panel grid gap-3 !rounded-2xl p-3 md:grid-cols-[auto_minmax(0,1fr)_auto] ${song.disabled ? "opacity-50" : ""}`}>
      {song.coverUrl ? (
        // Cover art from the song provider's CDN.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={song.coverUrl} alt="" className="size-20 rounded-xl object-cover" />
      ) : (
        <div className="flex size-20 items-center justify-center rounded-xl bg-petrol-dark text-4xl">💿</div>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-lg font-bold">
          {song.artist} – {song.title}
          {song.edited && <span className="ml-2 rounded-full chip px-2 py-0.5 text-xs">korrigiert</span>}
        </p>
        <p className="flex flex-wrap gap-2 text-sm text-cream/70">
          {song.genres.map((g) => (
            <span key={g} className="rounded-full chip px-2 py-0.5">
              {GENRE_LABEL[g] ?? g}
            </span>
          ))}
          <span>Bekanntheit {song.popularity.toLocaleString("de-DE")}</span>
          {song.sourceUrl && (
            <a href={song.sourceUrl} target="_blank" rel="noreferrer" className="underline">
              {song.provider}
            </a>
          )}
          {song.musicbrainzId && (
            <a href={`https://musicbrainz.org/recording/${song.musicbrainzId}`} target="_blank" rel="noreferrer" className="underline">
              MusicBrainz
            </a>
          )}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Titel-Aliase (Komma)
            <input value={titleAliases} onChange={(e) => setTitleAliases(e.target.value)} className="rounded-lg bg-cream px-2 py-1 text-brown" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Interpret-Aliase (Komma)
            <input value={artistAliases} onChange={(e) => setArtistAliases(e.target.value)} className="rounded-lg bg-cream px-2 py-1 text-brown" />
          </label>
        </div>
        {aliasesChanged && (
          <button
            type="button"
            onClick={() =>
              void onSave(song, { titleAliases: parseAliases(titleAliases), artistAliases: parseAliases(artistAliases) }, "Aliase gespeichert")
            }
            className="self-start rounded-full bg-orange px-4 py-1 font-bold text-brown"
          >
            Aliase speichern
          </button>
        )}
      </div>
      <div className="flex flex-col items-stretch gap-2 md:w-52">
        <label className="flex items-center justify-between gap-2">
          Jahr
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            inputMode="numeric"
            className="w-24 rounded-lg bg-cream px-2 py-1 text-right font-bold text-brown"
          />
        </label>
        <p className={`text-sm font-bold ${song.yearVerified ? "text-bulb" : "text-orange"}`}>{song.yearVerified ? "✓ bestätigt" : "? ungeprüft"}</p>
        <button
          type="button"
          disabled={!confirm || (song.yearVerified && confirm.originalYear === song.originalYear)}
          onClick={() => confirm && void onSave(song, confirm, `${song.title}: ${confirm.originalYear} bestätigt`)}
          className="rounded-full bg-bulb px-3 py-1 font-bold text-brown disabled:opacity-40"
        >
          ✓ Jahr bestätigen
        </button>
        <button
          type="button"
          disabled={!change || change.originalYear === song.originalYear}
          onClick={() => change && void onSave(song, change, `${song.title}: Jahr geändert (noch nicht bestätigt)`)}
          className="rounded-full bg-petrol-dark px-3 py-1 text-sm font-bold disabled:opacity-40"
        >
          Nur ändern
        </button>
        <button
          type="button"
          onClick={() => void onSave(song, { disabled: !song.disabled }, song.disabled ? "Wieder eingeschaltet" : "Ausgeschaltet")}
          className="rounded-full px-3 py-1 text-sm text-cream/70 hover:bg-petrol-dark/70"
        >
          {song.disabled ? "▶ Wieder spielen" : "⏸ Nie spielen"}
        </button>
      </div>
    </li>
  );
}
