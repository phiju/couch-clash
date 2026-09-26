/**
 * The host's lines for Pixelpanik (German). Add or change lines here – the
 * voice picks them up by itself (audio is made and cached on first use).
 *
 * - `{name}` is replaced with the player's name (the whole line is voiced
 *   per player and cached globally, so the same name costs only once).
 * - `family`: Familie (Normal) and Party · `party`: only in Party mode, on
 *   top of the family lines (cheekier, suggestive at most – never explicit)
 *   · `kids`: Kids mode only (nobody is ever out there, so: encouraging).
 * - The last 3 lines played per situation are locked (no repeats).
 *
 * Tone: cheeky, smug, never really insulting.
 */

export const PIXELPANIK_SITUATIONS = ["nobodyYet", "wrong", "earlyCorrect", "lateCorrect", "nobody"] as const;
export type PixelpanikSituation = (typeof PIXELPANIK_SITUATIONS)[number];

export interface PixelpanikLinePools {
  family: readonly string[];
  party: readonly string[];
  kids: readonly string[];
}

export const NAME = "{name}";

export const PIXELPANIK_LINES: Record<PixelpanikSituation, PixelpanikLinePools> = {
  /** Stage 2 and nobody has even tried – the host picks on a random player. */
  nobodyYet: {
    family: [
      "{name}, so sieht die Welt aus, wie du sie morgens ohne Brille siehst.",
      "{name}, ich sehe dich grübeln. Man hört es sogar.",
      "Na, {name}? Ein paar bunte Klötze, und schon herrscht Stille.",
      "{name}, das ist kein Bildschirmfehler. Das ist das Spiel.",
      "{name}, einfach mal raten. Schlimmer als gar nichts ist es auch nicht.",
      "Stille im Studio. {name}, sag doch wenigstens irgendwas.",
      "{name}, du kneifst die Augen zusammen. Das hilft übrigens nicht.",
      "{name}, das ist moderne Kunst. Da darf man ruhig was hineininterpretieren.",
      "Keiner traut sich. {name}, du bist doch sonst nicht so schüchtern.",
      "{name}, stell dir vor, du stehst ganz weit weg. Sehr, sehr weit.",
    ],
    party: [
      "{name}, so sieht die Welt nach dem vierten Aperol aus.",
      "{name}, so ungefähr sieht die Tanzfläche um drei Uhr morgens aus.",
      "{name}, kneif ruhig ein Auge zu. An der Bar klappt das doch auch.",
      "{name}, das sieht aus wie dein Handyfoto von letzter Nacht.",
      "{name}, verschwommen, bunt, keine Ahnung, was los ist. Kennst du doch vom Wochenende.",
      "{name}, stell dir vor, es ist der Morgen danach. Dann siehst du klarer.",
      "{name}, einfach raten. Beim Flirten machst du das doch auch.",
      "{name}, so sieht dein Date aus, bevor das Licht angeht.",
    ],
    kids: [
      "{name}, was könnte das sein? Einfach mal tippen!",
      "{name}, kneif die Augen zusammen. Vielleicht hilft's ja!",
      "Na, {name}? Das sind ganz schön große Klötzchen, oder?",
      "{name}, trau dich! Raten macht Spaß.",
      "{name}, stell dir vor, du guckst durch eine beschlagene Brille.",
      "Psst, {name}! Die Klötzchen verraten schon ein bisschen was.",
      "{name}, Detektive schauen ganz genau hin. Du auch?",
      "{name}, das Bild wird gleich schärfer. Aber vielleicht weißt du es schon?",
    ],
  },
  /** A wrong guess (Familie / Party: out for this picture · Kids: locked until the next stage). */
  wrong: {
    family: [
      "Raus, {name}. Setz dich hin und denk über dein Leben nach.",
      "{name} hat getippt. Mutig. Und falsch.",
      "Das war nichts, {name}. Ab auf die Zuschauertribüne.",
      "{name}, interessante Theorie. Leider komplett daneben.",
      "Falsch, {name}. Aber mit sehr viel Überzeugung vorgetragen.",
      "{name} ist raus. Bitte ab jetzt nur noch still leiden.",
      "Oh, {name}. Das war wohl eher ein Rorschach-Test.",
      "Tschüss, {name}. Für dieses Bild bist du nur noch Publikum.",
      "{name}, das Bild hat dich reingelegt. Und du hast es ihm leicht gemacht.",
    ],
    party: [
      "Raus, {name}. Hol dir erst mal was zu trinken.",
      "{name}, das war der Alkohol, oder? Sag, dass es der Alkohol war.",
      "Daneben, {name}. Ab an die Bar, da ist Raten weniger peinlich.",
      "{name} ist raus. Das Bild hat dich eiskalt abserviert.",
      "Falsch, {name}. Aber du siehst dabei immerhin gut aus.",
      "{name}, das war so daneben wie dein letzter Tanzschritt.",
      "Raus, {name}. Nimm es wie einen Korb. Das kennst du ja.",
      "{name}, das war nichts. Vielleicht erst mal ein Wasser.",
    ],
    kids: [
      "Knapp daneben, {name}! In der nächsten Stufe klappt's bestimmt.",
      "Oh, {name}, das war's leider nicht. Gleich nochmal!",
      "Nicht schlimm, {name}! Das Bild war ja noch ganz schön verpixelt.",
      "Hoppla, {name}! Kurz warten, dann darfst du nochmal.",
      "Das war's nicht, {name}. Aber du bist auf der Spur!",
      "{name}, das Bild hat dich ausgetrickst. Gleich nochmal versuchen!",
      "Fast, {name}! Schau nochmal ganz genau hin.",
      "Nein, {name}, aber guter Versuch! Die nächste Stufe kommt gleich.",
    ],
  },
  /** Right at 4×4 or 8×8. */
  earlyCorrect: {
    family: [
      "Röntgenaugen bei {name}. Oder geschummelt.",
      "{name}! Bei so wenigen Pixeln? Ich lasse das prüfen.",
      "Wie hat {name} das erkannt? Ich sehe da nur Klötze.",
      "{name} sieht Dinge, die wir anderen nicht sehen. Unheimlich.",
      "Zack! {name} hat's. Die anderen starren noch auf bunte Kacheln.",
      "{name}, entweder Genie oder Hellseher. Ich tippe auf Glück.",
      "{name} hat Adleraugen. Oder ein sehr gutes Gedächtnis für Klötzchen.",
      "Frechheit, {name}! Gib den anderen doch auch mal eine Chance.",
      "{name} hat's schon. Ich hatte noch nicht mal meinen Kaffee.",
    ],
    party: [
      "{name} hat's bei vier Pixeln. Was hast du getrunken, und wo gibt's das?",
      "Röntgenblick bei {name}. Pass auf, wem du damit in die Augen schaust.",
      "{name}, so schnell? Das ist ja fast schon unanständig.",
      "{name} erkennt Dinge im Dunkeln. Das erklärt einiges.",
      "Treffer, {name}! Deine Augen sind nüchterner als du.",
      "{name} hat's sofort. Ich will einen Dopingtest.",
      "{name}, das war schneller als jede Ausrede um vier Uhr früh.",
      "{name} sieht durch jeden Pixel. Beängstigend attraktiv.",
    ],
    kids: [
      "Wow, {name}! Du hast ja Adleraugen!",
      "{name} hat's schon erkannt! Bei so großen Klötzchen!",
      "Super, {name}! Wie hast du das so schnell gesehen?",
      "{name}, du bist ja ein richtiger Pixel-Profi!",
      "Blitzschnell, {name}! Das war ganz stark.",
      "{name} hat Röntgenaugen! Unglaublich!",
      "Klasse, {name}! Das haben die anderen noch gar nicht gesehen.",
      "{name}, du Superdetektiv! Richtig!",
    ],
  },
  /** Right only at full resolution. */
  lateCorrect: {
    family: [
      "Glückwunsch, {name}. Das hätte auch ein Toaster erkannt.",
      "Da ist es ja, {name}. In voller Pracht und zwanzig Punkte wert.",
      "{name} erkennt es. In HD. Respekt vor so viel Geduld.",
      "Na endlich, {name}. Ich dachte schon, du wartest auf die Blu-ray.",
      "Bravo, {name}. Mit Lupe und Anleitung geschafft.",
      "{name} hat's. Kurz bevor sich das Bild selbst verraten hätte.",
      "Auf den letzten Drücker, {name}. Aber Punkte sind Punkte.",
      "{name}, das nennt man wohl einen Spätzünder.",
      "Zwanzig Punkte für {name}. Für das Offensichtliche.",
    ],
    party: [
      "Glückwunsch, {name}. Das hätte auch ein Toaster nach drei Bier erkannt.",
      "{name}, du bist die Sorte Mensch, die erst das Licht anmacht und dann guckt.",
      "Endlich, {name}. Ist der Kater schon vorbei?",
      "{name} hat's. So wie man um sechs Uhr morgens erkennt, wo man ist.",
      "Zwanzig Punkte, {name}. Mehr gibt's für Spätzünder an dieser Bar nicht.",
      "{name}, erkannt bei voller Beleuchtung. Wie beim Rausschmeißerlicht.",
      "Na also, {name}. Auch bei dir wird es irgendwann hell.",
      "{name}, knapp vor der Sperrstunde. Respekt.",
    ],
    kids: [
      "Geschafft, {name}! Lieber spät als nie.",
      "Richtig, {name}! Jetzt sieht man's ja auch ganz genau.",
      "Da ist es, {name}! Gut hingeschaut.",
      "{name} hat's! Ganz in Ruhe, so macht man das.",
      "Jawoll, {name}! Auf den letzten Metern.",
      "Richtig, {name}! Beim nächsten Bild bist du bestimmt noch schneller.",
      "{name}, super! Erkannt ist erkannt.",
      "Gut gemacht, {name}! Das war knapp.",
    ],
  },
  /** Nobody got the picture (no name). */
  nobody: {
    family: [
      "Keiner. Ich bin enttäuscht von euch allen.",
      "Niemand? Wirklich niemand? Ich brauche einen Moment.",
      "Null Treffer. Eine Glanzleistung der Ahnungslosigkeit.",
      "Keiner hat's erkannt. Nächstes Mal zeige ich es euch einfach vorher.",
      "Tja. Das Bild hat gewonnen.",
      "Alle daneben. Vielleicht sollten wir mal über Brillen reden.",
      "Nicht einer. Ich schreibe das ins Protokoll.",
      "Keiner. Und dabei war es am Ende gestochen scharf.",
      "Kein Treffer. Das Bild lacht euch gerade aus.",
    ],
    party: [
      "Keiner. Ihr seid wohl alle schon zu voll.",
      "Niemand? Nüchtern wäre das nicht passiert.",
      "Keiner hat's. Ich bestelle euch allen eine Brille und ein Wasser.",
      "Null von allen. Das ist ja wie Flirten mit euch.",
      "Keiner. Das Bild geht heute allein nach Hause.",
      "Alle daneben. Die Party ist offiziell eskaliert.",
      "Nicht einer. Ich brauche jetzt selbst einen Schnaps.",
      "Keiner. Das Bild ist enttäuschter als jedes eurer Dates.",
    ],
    kids: [
      "Oh, das hat keiner erkannt. Das war aber auch schwer!",
      "Niemand? Macht nichts, das nächste Bild wird bestimmt leichter.",
      "Das Bild hat euch alle ausgetrickst!",
      "Keiner hat's gewusst. Jetzt wisst ihr's fürs nächste Mal!",
      "Huch, das war ein kniffliges Bild!",
      "Das war schwer! Aber beim nächsten Bild seid ihr dran.",
      "Keiner? Dann hat heute das Bild gewonnen.",
      "Oh, da haben alle danebengelegen. Weiter geht's!",
    ],
  },
};

/** The lines a situation may use in this game mode (Party: family + party lines). */
export function linesFor(situation: PixelpanikSituation, mode: "kids" | "family" | "party"): readonly string[] {
  const pools = PIXELPANIK_LINES[situation];
  if (mode === "kids") return pools.kids;
  if (mode === "party") return [...pools.family, ...pools.party];
  return pools.family;
}

export function fillName(line: string, name: string): string {
  return line.split(NAME).join(name);
}
