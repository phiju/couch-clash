/**
 * Question content. Files live in ../data and are validated with zod when
 * this module is loaded – a broken question file fails fast (and in tests).
 */
import { z } from "zod";
import bluffDe from "../data/bluff.de.json";
import estimateDe from "../data/estimate.de.json";
import fuehrerscheinDe from "../data/fuehrerschein.de.json";
import pixelpanikMotive from "../data/pixelpanik/motive.json";
import quizDe from "../data/quiz.de.json";
import skurrilDe from "../data/skurril.de.json";
import snarkLinesDe from "../data/snark-lines.de.json";
import songGenres from "../data/musik/genres.json";
import songsFile from "../data/musik/songs.json";
import testSongsFile from "../data/musik/test-songs.json";
import { SongFileSchema, SongImportConfigSchema } from "./music/schema";
import slfDe from "../data/stadt-land-fluss.de.json";
import {
  BluffWordSchema,
  EstimateQuestionSchema,
  FuehrerscheinQuestionSchema,
  PixelpanikFileSchema,
  QuizQuestionSchema,
  SkurrilStorySchema,
  SlfFileSchema,
  SnarkLinesSchema,
} from "./schema";

export * from "./schema";
export * from "./music";

function load<T extends z.ZodType>(schema: T, data: unknown, name: string): z.infer<T>[] {
  const questions = z.array(schema).parse(data, { error: () => `Invalid content in ${name}` });
  const ids = new Set<string>();
  for (const q of questions as { id: string }[]) {
    if (ids.has(q.id)) throw new Error(`Duplicate question id ${q.id} in ${name}`);
    ids.add(q.id);
  }
  return questions;
}

export const QUIZ_QUESTIONS_DE = load(QuizQuestionSchema, quizDe, "quiz.de.json");
export const ESTIMATE_QUESTIONS_DE = load(EstimateQuestionSchema, estimateDe, "estimate.de.json");
export const FUEHRERSCHEIN_QUESTIONS_DE = load(FuehrerscheinQuestionSchema, fuehrerscheinDe, "fuehrerschein.de.json");
export const BLUFF_WORDS_DE = load(BluffWordSchema, bluffDe, "bluff.de.json");
export const SKURRIL_STORIES_DE = load(SkurrilStorySchema, skurrilDe, "skurril.de.json");

/** The host's snarky, name-free lines per situation and pool (family / party / kids). */
export const SNARK_LINES_DE = SnarkLinesSchema.parse(snarkLinesDe, { error: () => "Invalid content in snark-lines.de.json" });

/** Pixelpanik motifs (all of them – motifs without pictures are skipped by the game). */
const pixelpanikFile = PixelpanikFileSchema.parse(pixelpanikMotive, { error: () => "Invalid content in pixelpanik/motive.json" });
export const PIXELPANIK_MOTIFS = load(PixelpanikFileSchema.shape.items.element, pixelpanikFile.items, "pixelpanik/motive.json");
/** Points per stage as noted in motive.json (the game uses the category's settings). */
export const PIXELPANIK_FILE_SCORING: Readonly<Record<string, number>> = pixelpanikFile.scoring;

/** Musik-Quiz: the song database (written by `pnpm songs:import`). */
const musikFile = SongFileSchema.parse(songsFile, { error: () => "Invalid content in musik/songs.json" });
export const MUSIK_SONGS = load(SongFileSchema.shape.items.element, musikFile.items, "musik/songs.json");
/** When `pnpm songs:import` last wrote songs.json (null before the first import). */
export const MUSIK_SONGS_IMPORTED_AT = musikFile.importedAt;
/** Local test songs (apps/web/public/test-audio) – development and tests only. */
export const MUSIK_TEST_SONGS = load(SongFileSchema.shape.items.element, SongFileSchema.parse(testSongsFile).items, "musik/test-songs.json");
/** Genres with their Deezer playlists and plausible years (import script). */
export const SONG_IMPORT_CONFIG = SongImportConfigSchema.parse(songGenres, { error: () => "Invalid content in musik/genres.json" });
/** Stadt, Land, Fluss: categories (per mode, fakt / kreativ), letters per mode and the round mix. */
export const SLF_DATA_DE = SlfFileSchema.parse(slfDe, { error: () => "Invalid content in stadt-land-fluss.de.json" });
