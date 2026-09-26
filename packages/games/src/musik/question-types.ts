/**
 * The Musik-Quiz question types as an extensible registry. A type says
 * which songs it can ask (song filter), which flow it plays (buzzer or
 * everyone-at-once estimate – the phone UI follows the flow), how an
 * answer is checked and what the TV may show while the music plays.
 * Scoring per flow lives in scoring.ts.
 *
 * A new type: add its id to MUSIK_QUESTION_TYPE_IDS + MUSIK_TYPE_INFO (meta),
 * register it here – the planner, the settings (option + weight) and the
 * views pick it up. A new flow needs its step handling in module.ts.
 */
import type { Song } from "@couch-clash/content";
import { checkArtist, matchesTerms, type ArtistMatch } from "./match";
import type { MusikQuestionTypeId } from "./meta";

/** A song ready to play (terms normalized once). */
export interface PreparedSong {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  yearVerified: boolean;
  coverUrl: string | null;
  sourceUrl: string | null;
  genres: string[];
  provider: Song["provider"];
  providerTrackId: string;
  /** Local test songs: the file. Provider songs: filled with a fresh URL at the round start. */
  previewUrl: string | null;
  titleTerms: string[];
  artistTerms: string[];
  memberTerms: string[];
  /** Only in Party mode (the song's modes have no kids/family). */
  party: boolean;
}

/** buzzer: first buzz answers, music pauses · estimate: everyone answers at once, the music keeps playing. */
export type MusikFlow = "buzzer" | "estimate";

export interface QuestionTypeDef {
  id: MusikQuestionTypeId;
  flow: MusikFlow;
  /** Song selection filter: can this song be asked this way? */
  fits(song: Song): boolean;
  /** Buzzer flow: checks a free-text answer ("partial" = band member instead of the band). */
  check?(answer: string, song: PreparedSong): ArtistMatch;
  /** Buzzer flow: the terms the optional AI check compares with. */
  terms?(song: PreparedSong): string[];
  /** Buzzer flow: what is asked, for the AI check ("den Songtitel"). */
  asked?: string;
  /** The right answer as text (AI check, host commentary). */
  answerText(song: PreparedSong): string;
  /** What the TV and phones may see while the music plays. */
  shows(song: PreparedSong): { title: string; artist: string } | null;
}

export const QUESTION_TYPES: Record<MusikQuestionTypeId, QuestionTypeDef> = {
  title: {
    id: "title",
    flow: "buzzer",
    fits: () => true,
    check: (answer, song) => (matchesTerms(answer, song.titleTerms) ? "full" : null),
    terms: (song) => song.titleTerms,
    asked: "den Songtitel",
    answerText: (song) => song.title,
    shows: () => null,
  },
  artist: {
    id: "artist",
    flow: "buzzer",
    fits: () => true,
    check: (answer, song) => checkArtist(answer, { artist: song.artistTerms, members: song.memberTerms }),
    terms: (song) => [...song.artistTerms, ...song.memberTerms],
    asked: "den Interpreten (Band oder Sänger:in)",
    answerText: (song) => song.artist,
    // The title would give the artist away.
    shows: () => null,
  },
  year: {
    id: "year",
    flow: "estimate",
    // Only years that passed the checks or an admin confirmed.
    fits: (song) => song.yearVerified && song.originalYear !== null,
    answerText: (song) => String(song.year ?? ""),
    shows: (song) => ({ title: song.title, artist: song.artist }),
  },
};

export function questionType(id: MusikQuestionTypeId): QuestionTypeDef {
  return QUESTION_TYPES[id];
}
