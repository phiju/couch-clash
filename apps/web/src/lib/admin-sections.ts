/** Everything the admin area links to – the start page's tiles and the nav on every admin page. */
export interface AdminSection {
  href: string;
  emoji: string;
  title: string;
  text: string;
  /** Developer tools (open in developer mode). */
  dev?: boolean;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    href: "/admin/fragen",
    emoji: "❓",
    title: "Fragen",
    text: "Statistik jeder Frage, Meldungen, Quarantäne, rauswerfen & Ersatz – und Moderator-Sprüche vertonen.",
  },
  {
    href: "/admin/songs",
    emoji: "🎶",
    title: "Songs",
    text: "Musik-Quiz: Jahre prüfen und bestätigen, Aliase für Titel und Interpret, Songs ausschalten.",
  },
  {
    href: "/admin/kosten",
    emoji: "💶",
    title: "Kosten",
    text: "Was OpenAI & Co. kosten, pro Monat und pro Tag – plus feste Abos wie Claude.",
  },
  {
    href: "/dev/survival?dev=1",
    emoji: "🟢",
    title: "Survival-Bühne",
    text: "Bühne, Startfahrt, Eliminierung und Treppchen mit 2–10 Testspielern ansehen.",
    dev: true,
  },
  {
    href: "/dev/sounds?dev=1",
    emoji: "🔊",
    title: "Sounds",
    text: "Jeden Sound und jede Musik einzeln anhören – mit den echten Lautstärken.",
    dev: true,
  },
];

/** Is this section the page at `pathname`? */
export function isActiveSection(section: AdminSection, pathname: string): boolean {
  return pathname === section.href.split("?")[0];
}
