import type { Metadata } from "next";
import { SoundTest } from "./sound-test";

export const metadata: Metadata = {
  title: "Soundtest – Couch Clash",
  robots: { index: false },
};

export default function SoundTestPage() {
  return <SoundTest />;
}
