import type { Metadata } from "next";
import { AdminQuestionsPage } from "./admin-questions";

export const metadata: Metadata = { title: "Fragen · Admin · Couch Clash", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminQuestionsPage />;
}
