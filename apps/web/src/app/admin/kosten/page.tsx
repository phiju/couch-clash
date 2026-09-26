import type { Metadata } from "next";
import { AdminCostsPage } from "./admin-costs";

export const metadata: Metadata = {
  title: "Kosten · Couch Clash",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AdminCostsPage />;
}
