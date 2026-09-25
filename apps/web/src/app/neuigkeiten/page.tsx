import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Logo, Screen } from "@/components/ui";
import { CHANGELOG } from "@/content/changelog";
import { formatReleaseDate, shortVersion } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Neuigkeiten – Couch Clash",
};

/** All versions as a timeline, newest on top. */
export default function NewsPage() {
  return (
    <Screen dim="soft" className="gap-6">
      <Link href="/" aria-label="Zur Startseite">
        <Logo className="w-40 sm:w-52" />
      </Link>
      <h1 className="text-center text-4xl font-bold text-bulb drop-shadow-[0_4px_0_var(--color-brown)] sm:text-5xl">
        Neuigkeiten
      </h1>
      <ol className="relative flex w-full max-w-2xl flex-col gap-6 border-l-4 border-bulb/40 pl-6 sm:pl-8">
        {CHANGELOG.map((entry, i) => (
          <li key={entry.version} className="relative">
            <span
              className={`absolute top-5 -left-[2.35rem] size-6 rounded-full border-4 border-bulb sm:-left-[2.85rem] ${i === 0 ? "bg-orange shadow-[0_0_18px_rgb(253_188_95/0.8)]" : "bg-petrol-dark"}`}
              aria-hidden
            />
            <article className="panel flex flex-col gap-3 px-5 py-4">
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-2xl font-bold">
                  <span className="text-bulb">Version {shortVersion(entry.version)}</span> · {entry.title}
                </h2>
                <time dateTime={entry.date} className="text-sm text-cream/70">
                  {formatReleaseDate(entry.date)}
                </time>
              </header>
              <ul className="flex flex-col gap-2">
                {entry.items.map((item) => (
                  <li key={item.text} className="flex items-center gap-3 rounded-2xl chip px-4 py-2 text-lg">
                    <span className="text-[1.4em]" aria-hidden>
                      {item.emoji}
                    </span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </article>
          </li>
        ))}
      </ol>
      <ButtonLink href="/" className="px-10 text-2xl">
        Zur Startseite
      </ButtonLink>
    </Screen>
  );
}
