"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_SECTIONS, isActiveSection } from "@/lib/admin-sections";

/** One row of links on every admin and dev page – no URLs to remember. */
export function AdminNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm font-bold whitespace-nowrap ${active ? "bg-bulb text-brown" : "chip hover:bg-petrol-dark/70"}`;
  return (
    <nav className={`flex flex-wrap items-center gap-2 ${className}`} aria-label="Admin-Bereich">
      <Link href="/admin" className={pill(pathname === "/admin")}>
        🏠 Admin
      </Link>
      {ADMIN_SECTIONS.map((s) => (
        <Link key={s.href} href={s.href} className={pill(isActiveSection(s, pathname))}>
          {s.emoji} {s.title}
        </Link>
      ))}
    </nav>
  );
}
