"use client";

import { accountUsageText, monthCosts, type AdminCostsResponse } from "@couch-clash/shared";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { TokenForm } from "./fragen/admin-questions";
import { AdminNav } from "@/components/admin-nav";
import { Screen } from "@/components/ui";
import { AdminApiError, adminApi, adminTokenStore, saveAdminToken } from "@/lib/admin-api";
import { ADMIN_SECTIONS } from "@/lib/admin-sections";

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** /admin: one place for everything behind the admin token (and the developer tools). */
export function AdminHome() {
  const token = useSyncExternalStore(adminTokenStore.subscribe, adminTokenStore.get, adminTokenStore.getServer);
  const logout = useCallback((message?: string) => {
    saveAdminToken(null);
    if (message) window.alert(message);
  }, []);
  if (token === undefined) return <Screen />;
  if (!token) return <TokenForm title="Admin 🔒" onSubmit={(t) => saveAdminToken(t)} />;
  return <Overview token={token} onLogout={logout} />;
}

function Overview({ token, onLogout }: { token: string; onLogout: (message?: string) => void }) {
  const [costs, setCosts] = useState<{ data: AdminCostsResponse; month: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    adminApi.costs(token).then(
      (data) => !cancelled && setCosts({ data, month: new Date().toISOString().slice(0, 7) }),
      (err: unknown) => {
        if (!cancelled && err instanceof AdminApiError && err.status === 401) onLogout("Token ungültig.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, onLogout]);
  const month = costs ? monthCosts(costs.data, costs.month) : null;
  // A short live line under some tiles.
  const hints: Record<string, string | null> = {
    "/admin/kosten": month ? `Diesen Monat: ${EURO.format(month.totalEur)}` : null,
    "/admin/fragen": costs?.data.elevenlabs ? accountUsageText(costs.data.elevenlabs) : null,
  };

  return (
    <Screen className="max-w-[1100px] !items-stretch gap-6 text-base">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">🛠️ Admin</h1>
        <button type="button" onClick={() => onLogout()} className="rounded-full px-3 py-1 text-sm text-cream/70 hover:bg-petrol-dark/70">
          Abmelden
        </button>
      </header>
      <AdminNav />
      <ul className="grid gap-4 sm:grid-cols-2">
        {ADMIN_SECTIONS.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="panel flex h-full flex-col gap-2 p-5 transition hover:-translate-y-0.5 hover:border-bulb">
              <span className="flex items-center gap-3 text-2xl font-bold">
                <span className="text-3xl">{s.emoji}</span>
                {s.title}
                {s.dev && <span className="chip rounded-full px-2 py-0.5 text-xs font-bold text-cream/70">Entwickler</span>}
              </span>
              <span className="text-cream/80">{s.text}</span>
              {hints[s.href] && <span className="mt-auto pt-1 text-sm font-bold text-bulb">{hints[s.href]}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-cream/60">
        Merk dir nur <strong>/admin</strong> – alles andere ist von hier aus verlinkt. Der Admin-Token gilt für alle Seiten in diesem Tab.
      </p>
    </Screen>
  );
}
