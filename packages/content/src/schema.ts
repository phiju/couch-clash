import {
  AGE_RATINGS,
  ARMS,
  KNOWLEDGE_CATEGORIES,
  TURNS,
  VEHICLE_COLORS,
  VEHICLE_TYPES,
  exitArm,
  type QuestionMedia,
} from "@couch-clash/shared";
import { z } from "zod";

const base = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  text: z.string().min(5).max(200),
  ageRating: z.union(AGE_RATINGS.map((a) => z.literal(a))),
  tags: z.array(z.string().min(1)).min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Game mode filter: alcohol topics (not in Kids). */
  alcohol: z.boolean().default(false),
  /** Game mode filter: sexual / suggestive (Party only, never explicit). */
  adult: z.boolean().default(false),
};

/** Quiz + estimate: the question's topic (optional – AI-generated items may lack it). */
const knowledge = {
  primaryCategory: z.enum(KNOWLEDGE_CATEGORIES).optional(),
};

export const QuizQuestionSchema = z
  .object({
    ...base,
    ...knowledge,
    options: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)]),
    correctIndex: z.number().int().min(0).max(3),
  })
  .refine((q) => new Set(q.options).size === 4, "Options must be distinct");

export const EstimateQuestionSchema = z
  .object({
    ...base,
    ...knowledge,
    answer: z.number().finite(),
    /** Shown after the number, e.g. "m", "km". Empty for years. */
    unit: z.string().max(20),
    /** "year" is displayed without thousands separator. */
    format: z.enum(["number", "year"]).default("number"),
    /**
     * Proximity scoring: the error (same unit as the answer) at which the
     * score reaches 0. Default: |answer| (100 % of the correct value).
     */
    zeroRange: z.number().finite().positive().optional(),
    /** Short fact shown at the reveal. */
    fact: z.string().max(200).optional(),
  })
  // A percentage of the answer makes no sense for years or for answers near 0.
  .refine((q) => q.format !== "year" || q.zeroRange !== undefined, {
    message: "Year questions need a zeroRange (e.g. 25–50 years)",
    path: ["zeroRange"],
  })
  .refine((q) => q.answer !== 0 || q.zeroRange !== undefined, {
    message: "Questions whose answer is 0 need a zeroRange",
    path: ["zeroRange"],
  });

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

/** Official sign number (VzKat), e.g. "206", "274-53", "242.1" – also the file name in public/signs. */
const signNumber = z.string().regex(/^\d{3,4}(\.\d)?(-\d{2})?$/, "A VzKat sign number like 206 or 1020-30");
const arm = z.enum(ARMS);

export const SignMediaSchema = z.object({
  kind: z.literal("sign"),
  signs: z.array(signNumber).min(1).max(3),
});

export const SceneMediaSchema = z
  .object({
    kind: z.literal("scene"),
    arms: z.array(arm).min(3).max(4),
    signs: z.partialRecord(arm, z.array(signNumber).min(1).max(3)),
    priorityPath: z.tuple([arm, arm]).nullable(),
    vehicles: z
      .array(
        z.object({
          id: z.string().min(1).max(20),
          type: z.enum(VEHICLE_TYPES),
          color: z.enum(VEHICLE_COLORS),
          from: arm,
          turn: z.enum(TURNS),
          siren: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(4),
    pedestrians: z.array(z.object({ at: arm, crossing: z.boolean() })).max(2).optional(),
  })
  .superRefine((s, ctx) => {
    const arms = new Set(s.arms);
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (arms.size !== s.arms.length) issue("Arms must be distinct");
    for (const a of Object.keys(s.signs)) if (!arms.has(a as never)) issue(`Signs at missing arm ${a}`);
    if (s.priorityPath && (s.priorityPath[0] === s.priorityPath[1] || !s.priorityPath.every((a) => arms.has(a)))) {
      issue("priorityPath must connect two existing arms");
    }
    if (new Set(s.vehicles.map((v) => v.id)).size !== s.vehicles.length) issue("Vehicle ids must be unique");
    // Vehicles are named by colour in the question – two of one colour would be ambiguous.
    if (new Set(s.vehicles.map((v) => v.color)).size !== s.vehicles.length) issue("Vehicle colours must be unique");
    for (const v of s.vehicles) {
      if (!arms.has(v.from)) issue(`Vehicle ${v.id} comes from missing arm ${v.from}`);
      else if (!arms.has(exitArm(v.from, v.turn))) issue(`Vehicle ${v.id} turns into missing arm`);
      if (v.siren && v.type !== "police") issue(`Only police cars have a siren (${v.id})`);
    }
    for (const p of s.pedestrians ?? []) if (!arms.has(p.at)) issue(`Pedestrian at missing arm ${p.at}`);
  });

export const QuestionMediaSchema = z.discriminatedUnion("kind", [SignMediaSchema, SceneMediaSchema]);

/** Führerscheinprüfung: a quiz question with an explanation and an optional picture. */
export const FuehrerscheinQuestionSchema = z
  .object({
    ...base,
    ...knowledge,
    text: z.string().min(5).max(120),
    options: z.tuple([z.string().min(1).max(40), z.string().min(1).max(40), z.string().min(1).max(40), z.string().min(1).max(40)]),
    correctIndex: z.number().int().min(0).max(3),
    /** One short sentence why – shown at the reveal (not read out). */
    explanation: z.string().min(5).max(140),
    media: QuestionMediaSchema.nullable(),
  })
  .refine((q) => new Set(q.options).size === 4, "Options must be distinct");

export type FuehrerscheinQuestion = z.infer<typeof FuehrerscheinQuestionSchema>;

// The zod shape and the client-side type must stay the same.
const mediaMatches: z.infer<typeof QuestionMediaSchema> extends QuestionMedia ? true : never = true;
void mediaMatches;
export type EstimateQuestion = z.infer<typeof EstimateQuestionSchema>;

/** Bluff-Lexikon: a very rare real German NOUN (mostly Latin/Greek) and its meaning. */
export const BluffWordSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  article: z.enum(["der", "die", "das"]),
  /** A noun: capitalized, one word. */
  word: z.string().regex(/^\p{Lu}[\p{L}-]+$/u, "A single capitalized noun").max(40),
  /** Plural nouns ("die Vibrissen") → "Vibrissen sind …?". */
  plural: z.boolean().optional(),
  /** Short, like a dictionary entry, without the word itself. */
  definition: z.string().min(3).max(80),
  ageRating: z.union(AGE_RATINGS.map((a) => z.literal(a))),
  tags: z.array(z.string().min(1)).min(1),
  difficulty: z.union([z.literal(2), z.literal(3)]),
  alcohol: z.boolean().default(false),
  adult: z.boolean().default(false),
  sourceNote: z.string().max(120).optional(),
});

export type BluffWord = z.infer<typeof BluffWordSchema>;

/**
 * Skurrile Ereignisse: a true, bizarre story. The players read the context
 * and the question, invent an answer and look for the true one.
 */
export const SkurrilStorySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** The start of the story (≈ 3 lines on a TV). */
    context: z.string().min(10).max(230),
    question: z.string().min(5).max(100),
    /** Short and polished like a player answer: no final full stop. */
    answer: z
      .string()
      .min(1)
      .max(80)
      .refine((a) => !/[.!]$/u.test(a.trim()), "No final full stop"),
    /** Shown at the reveal. */
    fact: z.string().min(5).max(220),
    year: z.number().int().min(-3000).max(2100).nullable(),
    primaryCategory: z.enum(KNOWLEDGE_CATEGORIES),
    tags: z.array(z.string().min(1)).min(1),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    ageRating: z.union([z.literal(6), z.literal(12), z.literal(18)]),
    /** Party stories (only with ageRating 18). */
    adult: z.boolean(),
    source: z.url({ protocol: /^https?$/ }),
  })
  .refine((s) => s.adult === (s.ageRating === 18), { message: "adult ⇔ ageRating 18", path: ["adult"] });

export type SkurrilStory = z.infer<typeof SkurrilStorySchema>;

/**
 * Snarky host lines without names (the host puts the player's name clip in
 * front). Audio is generated once and cached globally – so lines never
 * contain names or anything room-specific.
 */
export const SNARK_SITUATIONS = [
  "wrong",
  "wrongStreak",
  "lastPlace",
  "allWrong",
  "allRight",
  "surpriseRight",
  "leader",
  "fooledMany",
  "fooledNone",
  "wildEstimate",
  "bullseye",
] as const;
export type SnarkSituation = (typeof SNARK_SITUATIONS)[number];

export const SNARK_POOLS = ["family", "party", "kids"] as const;
export type SnarkPool = (typeof SNARK_POOLS)[number];

const snarkLine = z.string().min(3).max(100);

export const SnarkLinesSchema = z
  .strictObject(
    Object.fromEntries(
      SNARK_SITUATIONS.map((s) => [
        s,
        z.strictObject({ family: z.array(snarkLine).min(1), party: z.array(snarkLine), kids: z.array(snarkLine).min(1) }),
      ]),
    ) as Record<SnarkSituation, z.ZodObject<{ family: z.ZodArray<typeof snarkLine>; party: z.ZodArray<typeof snarkLine>; kids: z.ZodArray<typeof snarkLine> }>>,
  )
  .refine((d) => {
    const all = Object.values(d).flatMap((m) => [...m.family, ...m.party, ...m.kids]);
    return new Set(all).size === all.length;
  }, "Snark lines must be unique");

export type SnarkLines = z.infer<typeof SnarkLinesSchema>;

// ── Pixelpanik: pictures that start as a few big pixels and get sharper ──

/** Stages per picture: 4×4, 8×8, 16×16, 32×32, 64×64 blocks, then full resolution. */
export const PIXELPANIK_STAGE_SIZES = [4, 8, 16, 32, 64, 0] as const;

export const PIXELPANIK_MOTIF_MODES = ["kinder", "erwachsene", "party"] as const;
export type PixelpanikMotifMode = (typeof PIXELPANIK_MOTIF_MODES)[number];

const motifAnswer = z.string().trim().min(1).max(60);

/**
 * The pictures of one motif, written by the image script
 * (packages/content/scripts/pixelpanik-images.mjs). `stages[i]` is the
 * picture for stage i: pre-rendered N×N pixels for stages 1–5, the full
 * picture for stage 6. Every file has its own random name – the URL of one
 * stage says nothing about the others (the TV only ever gets the current one).
 */
export const PixelpanikImageSchema = z.object({
  stages: z.array(z.url()).length(PIXELPANIK_STAGE_SIZES.length),
  /** Paintings: where the public-domain file comes from. */
  source: z
    .object({
      url: z.url(),
      title: z.string().min(1),
      author: z.string().optional(),
      license: z.string().optional(),
    })
    .optional(),
});
export type PixelpanikImage = z.infer<typeof PixelpanikImageSchema>;

export const PixelpanikMotifSchema = z
  .object({
    id: z.string().regex(/^pp-\d{3,}$/),
    /** Topic (bauwerke, flaggen, tiere, …) – a round mixes them. "party" = party motifs. */
    category: z.string().regex(/^[a-z]+$/),
    answer: motifAnswer,
    /** Also counted as right (spelling variants, other names). */
    synonyms: z.array(motifAnswer),
    difficulty: z.enum(["leicht", "mittel", "schwer"]),
    modes: z.array(z.enum(PIXELPANIK_MOTIF_MODES)).min(1),
    /** Kids mode: four options, one of them the answer. */
    kids_choices: z.tuple([motifAnswer, motifAnswer, motifAnswer, motifAnswer]).nullable(),
    image_source: z.enum(["ai", "svg", "wikimedia"]),
    /** "ai": the prompt for the image model; otherwise a note for humans. */
    image_prompt: z.string().min(5),
    /** "svg": ISO code of the flag in the npm package flag-icons (flags/1x1/<code>.svg). */
    flag_code: z.string().regex(/^[a-z]{2}(-[a-z]+)?$/).optional(),
    /** "wikimedia": file name on Wikimedia Commons (without "File:"). */
    wikimedia_file: z.string().min(5).optional(),
    /** Missing until the image script ran – such motifs are not played. */
    image: PixelpanikImageSchema.optional(),
  })
  .refine((m) => !m.modes.includes("kinder") || m.kids_choices !== null, {
    message: "Kids motifs need kids_choices",
    path: ["kids_choices"],
  })
  .refine((m) => !m.kids_choices || (m.kids_choices.includes(m.answer) && new Set(m.kids_choices).size === 4), {
    message: "kids_choices: four different options including the answer",
    path: ["kids_choices"],
  })
  .refine((m) => m.image_source !== "svg" || !!m.flag_code, { message: "Flags need a flag_code", path: ["flag_code"] })
  .refine((m) => m.image_source !== "wikimedia" || !!m.wikimedia_file, {
    message: "Paintings need a wikimedia_file",
    path: ["wikimedia_file"],
  });
export type PixelpanikMotif = z.infer<typeof PixelpanikMotifSchema>;

export const PixelpanikFileSchema = z.object({
  category: z.literal("pixelpanik"),
  /** Points per stage (4x4 … full) – the defaults of the category's meta, kept here for reference. */
  scoring: z.record(z.string(), z.number().int().min(0)),
  items: z.array(PixelpanikMotifSchema),
});

// ── Stadt, Land, Fluss: categories and letters per mode ──

export const SLF_CATEGORY_MODES = ["kinder", "familie", "party"] as const;
export type SlfCategoryMode = (typeof SLF_CATEGORY_MODES)[number];

/** fakt: the AI checks letter AND plausibility · kreativ: anything with the right letter counts. */
export const SLF_CATEGORY_TYPES = ["fakt", "kreativ"] as const;
export type SlfCategoryType = (typeof SLF_CATEGORY_TYPES)[number];

export const SlfCategorySchema = z.object({
  id: z.string().regex(/^[a-z]-[a-z0-9-]+$/),
  /** What TV, phone and voice say ("Stadt", "Ausrede fürs Zuspätkommen"). */
  label: z.string().trim().min(2).max(40),
  /** Small print under the label (TV and phone only). */
  hint: z.string().trim().min(2).max(60).optional(),
  /** kinder: Kids + Familie · familie: Familie + Party · party: Party only. */
  mode: z.enum(SLF_CATEGORY_MODES),
  type: z.enum(SLF_CATEGORY_TYPES),
});
export type SlfCategory = z.infer<typeof SlfCategorySchema>;

const letterPool = z
  .string()
  .regex(/^[A-Z]+$/)
  .refine((s) => new Set(s).size === s.length, "Letters must be unique");

export const SlfFileSchema = z
  .object({
    category: z.literal("stadt-land-fluss"),
    /** Letters drawn per mode (Kids without C, Q, X, Y). */
    letters: z.strictObject({ kinder: letterPool, familie: letterPool, party: letterPool }),
    mix: z.strictObject({
      /** Party mode: at least this many categories of a round come from the party pool. */
      partyMinPerRound: z.number().int().min(0).max(6),
      /** At least this many "kreativ" categories per round (the funniest-answer vote needs them). */
      creativeMinPerRound: z.number().int().min(0).max(6),
    }),
    categories: z.array(SlfCategorySchema).min(1),
  })
  .refine((d) => !/[CQXY]/.test(d.letters.kinder), { message: "Kids letters without C, Q, X, Y", path: ["letters", "kinder"] })
  .refine((d) => new Set(d.categories.map((c) => c.id)).size === d.categories.length, "Category ids must be unique")
  .refine((d) => d.categories.every((c) => c.mode !== "party" || c.id.startsWith("p-")), "Party categories use the prefix p-");
export type SlfFile = z.infer<typeof SlfFileSchema>;
