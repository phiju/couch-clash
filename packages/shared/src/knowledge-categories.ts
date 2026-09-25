/**
 * Topic of a knowledge question (quiz, estimate): exactly one primary
 * category per question. Ids are stored in the content files – never rename.
 */
export const KNOWLEDGE_CATEGORIES = [
  "HISTORY",
  "GEOGRAPHY",
  "SCIENCE",
  "NATURE",
  "TECHNOLOGY",
  "SPORTS",
  "MOVIES_TV",
  "MUSIC",
  "ART_CULTURE",
  "LANGUAGE_LITERATURE",
  "FOOD_DRINK",
  "SOCIETY",
  "BUSINESS",
  "MOBILITY",
  "GAMES",
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

/** German display names. */
export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  HISTORY: "Geschichte",
  GEOGRAPHY: "Geografie",
  SCIENCE: "Wissenschaft",
  NATURE: "Natur & Tiere",
  TECHNOLOGY: "Technik",
  SPORTS: "Sport",
  MOVIES_TV: "Film & Fernsehen",
  MUSIC: "Musik",
  ART_CULTURE: "Kunst & Kultur",
  LANGUAGE_LITERATURE: "Sprache & Literatur",
  FOOD_DRINK: "Essen & Trinken",
  SOCIETY: "Gesellschaft",
  BUSINESS: "Wirtschaft",
  MOBILITY: "Verkehr & Mobilität",
  GAMES: "Spiele",
};
