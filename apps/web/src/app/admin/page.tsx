import type { Metadata } from "next";
import { AdminHome } from "./admin-home";

export const metadata: Metadata = {
  title: "Admin · Couch Clash",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AdminHome />;
}
