import type { Metadata, Viewport } from "next";
import { Fredoka, Special_Elite } from "next/font/google";
import { preload } from "react-dom";
import "./globals.css";

const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-fredoka",
  display: "swap",
});

/** Typewriter / rubber-stamp look for the Führerschein exam sheet. */
const stamp = Special_Elite({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-special-elite",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Couch Clash",
  description: "Die Partyspiel-Show fürs Wohnzimmer – ein Fernseher, alle Handys.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#123f3c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Only the background that matches the screen shape is fetched early.
  preload("/brand/stage-wide.webp", { as: "image", media: "(min-aspect-ratio: 3/4)", fetchPriority: "high" });
  preload("/brand/stage-tall.webp", { as: "image", media: "(max-aspect-ratio: 3/4)", fetchPriority: "high" });
  return (
    <html lang="de" className={`${fredoka.variable} ${stamp.variable}`}>
      <body className="min-h-dvh antialiased">
        <div className="stage-bg" aria-hidden />
        {children}
      </body>
    </html>
  );
}
