import type { Metadata } from "next";
import { AdminSongsPage } from "./admin-songs";

export const metadata: Metadata = {
  title: "Songs · Admin · Couch Clash",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AdminSongsPage />;
}
