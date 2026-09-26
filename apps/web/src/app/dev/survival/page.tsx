import type { Metadata } from "next";
import { SurvivalPreview } from "./survival-preview";

export const metadata: Metadata = {
  title: "Survival-Bühne – Couch Clash",
  robots: { index: false },
};

export default function SurvivalPreviewPage() {
  return <SurvivalPreview />;
}
