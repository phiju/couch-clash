"use client";

import {
  COST_KIND_LABELS,
  accountUsageText,
  costMonths,
  dailyCosts,
  monthCosts,
  type AdminCostsResponse,
  type CostCurrency,
  type FixedCost,
  type FixedCostInput,
} from "@couch-clash/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { TokenForm } from "../fragen/admin-questions";
import { Screen } from "@/components/ui";
import { AdminApiError, adminApi, adminTokenStore, saveAdminToken } from "@/lib/admin-api";

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (v: number) => (v > 0 && v < 0.005 ? "< 0,01 €" : EURO.format(v));
const int = (v: number) => v.toLocaleString("de-DE");
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
const dayLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

export function AdminCostsPage() {
  const token = useSyncExternalStore(adminTokenStore.subscribe, adminTokenStore.get, adminTokenStore.getServer);
  const logout = useCallback((message?: string) => {
    saveAdminToken(null);
    if (message) window.alert(message);
  }, []);
  if (token === undefined) return <Screen />;
  if (!token) return <TokenForm title="Kosten 🔒" onSubmit={(t) => saveAdminToken(t)} />;
  return <CostsView token={token} onLogout={logout} />;
}

interface Loaded {
  data: AdminCostsResponse;
  today: string;
}

function CostsView({ token, onLogout }: { token: string; onLogout: (message?: string) => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi.costs(token).then(
      (data) => {
        if (cancelled) return;
        setLoaded({ data, today: new Date().toISOString().slice(0, 10) });
        setError(null);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof AdminApiError && err.status === 401) return onLogout("Token ungültig.");
        setError(err instanceof Error ? err.message : "Fehler");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, onLogout, reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  const currentMonth = loaded?.today.slice(0, 7) ?? null;
  const months = useMemo(() => (loaded && currentMonth ? costMonths(loaded.data, currentMonth) : []), [loaded, currentMonth]);
  const shown = month ?? currentMonth;
  const sums = useMemo(() => (loaded && shown ? monthCosts(loaded.data, shown) : null), [loaded, shown]);
  const days = useMemo(() => (loaded ? dailyCosts(loaded.data, loaded.today, 30) : []), [loaded]);

  return (
    <Screen className="max-w-[1100px] !items-stretch gap-4 text-base">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">💶 Kosten</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/admin/fragen" className="rounded-full px-3 py-1 font-bold hover:bg-petrol-dark/70">
            ❓ Fragen-Admin
          </Link>
          <button type="button" onClick={reload} className="rounded-full px-3 py-1 font-bold hover:bg-petrol-dark/70">
            ↻ Neu laden
          </button>
          <button type="button" onClick={() => onLogout()} className="rounded-full px-3 py-1 text-cream/70 hover:bg-petrol-dark/70">
            Abmelden
          </button>
        </div>
      </header>

      {error && <p className="rounded-xl bg-rust px-4 py-2 font-bold">{error}</p>}
      {!loaded && !error && <p className="text-cream/70">Lädt …</p>}

      {loaded && sums && shown && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 font-bold">
              Monat
              <select
                value={shown}
                onChange={(e) => setMonth(e.target.value)}
                className="rounded-xl border-2 border-cream/25 bg-petrol-dark/80 px-3 py-1 text-cream"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            {loaded.data.elevenlabs && <span className="chip rounded-full px-3 py-1 text-sm">{accountUsageText(loaded.data.elevenlabs)}</span>}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Gesamt" value={eur(sums.totalEur)} strong />
            <Tile label="Gemessen (API)" value={eur(sums.measuredEur)} />
            <Tile label="Fest (Abos)" value={eur(sums.fixedEur)} />
            <Tile
              label="Ø pro Foto-Avatar"
              value={sums.eurPerAvatar === null ? "–" : eur(sums.eurPerAvatar)}
              hint={sums.avatars > 0 ? `${int(sums.avatars)} Avatare, inkl. Gesichter + Figuren` : "noch keine"}
            />
          </div>

          <DailyChart days={days} />

          <section className="panel p-4" aria-label="Gemessene Kosten nach Art">
            <h2 className="mb-3 text-xl font-bold">Gemessen im {monthLabel(shown)}</h2>
            {sums.byKind.length === 0 ? (
              <p className="text-cream/70">Keine API-Aufrufe in diesem Monat.</p>
            ) : (
              <table className="w-full text-left">
                <thead className="text-sm text-cream/70">
                  <tr>
                    <th className="py-1 font-normal">Wofür</th>
                    <th className="py-1 text-right font-normal">Aufrufe</th>
                    <th className="py-1 text-right font-normal">Kosten</th>
                  </tr>
                </thead>
                <tbody>
                  {sums.byKind.map((k) => (
                    <tr key={k.kind} className="border-t border-cream/10">
                      <td className="py-1.5">{COST_KIND_LABELS[k.kind]}</td>
                      <td className="py-1.5 text-right tabular-nums">{int(k.calls)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {k.units > 0 && k.eur === 0 ? `${int(k.units)} Credits (im Abo)` : eur(k.eur)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-cream/30 font-bold">
                    <td className="py-1.5">Summe</td>
                    <td className="py-1.5 text-right tabular-nums">{int(sums.byKind.reduce((s, k) => s + k.calls, 0))}</td>
                    <td className="py-1.5 text-right tabular-nums">{eur(sums.measuredEur)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>

          <FixedCosts
            token={token}
            fixed={loaded.data.fixed}
            month={shown}
            currentMonth={currentMonth!}
            usdToEur={loaded.data.usdToEur}
            onChanged={reload}
            onUnauthorized={() => onLogout("Token ungültig.")}
          />

          <p className="text-sm text-cream/60">
            Gemessen wird ab dem Einbau dieser Seite – ältere Kosten fehlen. Die API-Kosten sind Schätzungen aus den Token-Zahlen und der
            Preisliste im Server; die echte Rechnung steht bei OpenAI. Dollar werden fest mit {loaded.data.usdToEur.toLocaleString("de-DE")}{" "}
            in Euro umgerechnet.
          </p>
        </>
      )}
    </Screen>
  );
}

function Tile({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`panel flex flex-col gap-1 p-4 ${strong ? "border-bulb" : ""}`}>
      <span className="text-sm text-cream/70">{label}</span>
      <span className={`font-bold tabular-nums ${strong ? "text-3xl text-bulb" : "text-2xl"}`}>{value}</span>
      {hint && <span className="text-xs text-cream/60">{hint}</span>}
    </div>
  );
}

/** Measured € per day, last 30 days – one series, so no legend; hover shows the value. */
function DailyChart({ days }: { days: { day: string; eur: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.eur), 0);
  const total = days.reduce((s, d) => s + d.eur, 0);
  const active = hover === null ? null : days[hover];
  return (
    <section className="panel p-4" aria-label="Gemessene Kosten pro Tag">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">API-Kosten pro Tag · letzte 30 Tage</h2>
        <span className="text-sm tabular-nums text-cream/80">
          {active ? `${dayLabel(active.day)}: ${eur(active.eur)}` : `zusammen ${eur(total)}`}
        </span>
      </div>
      {max === 0 ? (
        <p className="text-cream/70">Noch keine gemessenen Aufrufe.</p>
      ) : (
        <>
          <div className="relative flex h-40 items-end gap-[2px] border-b border-cream/30" onMouseLeave={() => setHover(null)}>
            <span className="pointer-events-none absolute -top-1 left-0 text-xs text-cream/50">{eur(max)}</span>
            {days.map((d, i) => (
              <div
                key={d.day}
                className="flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                role="img"
                aria-label={`${dayLabel(d.day)}: ${eur(d.eur)}`}
              >
                <div
                  className={`w-full rounded-t-[4px] ${hover === i ? "bg-cream" : "bg-bulb"}`}
                  style={{ height: d.eur > 0 ? `max(2px, ${(d.eur / max) * 100}%)` : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-cream/50">
            <span>{dayLabel(days[0]!.day)}</span>
            <span>heute</span>
          </div>
        </>
      )}
    </section>
  );
}

const EMPTY_FORM = (month: string): FixedCostInput => ({ name: "", amount: 0, currency: "EUR", since: month, until: null, note: null });

function FixedCosts({
  token,
  fixed,
  month,
  currentMonth,
  usdToEur,
  onChanged,
  onUnauthorized,
}: {
  token: string;
  fixed: FixedCost[];
  month: string;
  currentMonth: string;
  usdToEur: number;
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [form, setForm] = useState<FixedCostInput>(() => EMPTY_FORM(currentMonth));
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      onChanged();
      return true;
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) onUnauthorized();
      else setMessage(err instanceof Error ? err.message : "Fehler");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const ok = await run(() => (editing === null ? adminApi.addFixedCost(token, form) : adminApi.updateFixedCost(token, editing, form)));
    if (ok) {
      setEditing(null);
      setForm(EMPTY_FORM(currentMonth));
    }
  }

  const perMonth = (c: FixedCost) => (c.currency === "USD" ? `${c.amount.toLocaleString("de-DE")} $ (≈ ${eur(c.amount * usdToEur)})` : eur(c.amount));
  const input = "rounded-xl border-2 border-cream/25 bg-petrol-dark/80 px-3 py-1.5 text-cream outline-none focus:border-bulb";

  return (
    <section className="panel flex flex-col gap-3 p-4" aria-label="Feste Kosten">
      <h2 className="text-xl font-bold">Feste Kosten pro Monat</h2>
      {fixed.length === 0 ? (
        <p className="text-cream/70">Noch keine – z. B. das Claude-Abo, der ElevenLabs-Plan oder die Domain.</p>
      ) : (
        <ul className="flex flex-col">
          {fixed.map((c) => {
            const running = c.since <= month && (c.until === null || c.until >= month);
            return (
              <li key={c.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-cream/10 py-2 ${running ? "" : "text-cream/50"}`}>
                <span className="font-bold">{c.name}</span>
                <span className="tabular-nums">{perMonth(c)}</span>
                <span className="text-sm text-cream/70">
                  ab {monthLabel(c.since)}
                  {c.until ? ` bis ${monthLabel(c.until)}` : " · läuft"}
                </span>
                {c.note && <span className="text-sm text-cream/60">{c.note}</span>}
                <span className="ml-auto flex gap-1 text-sm">
                  <button
                    type="button"
                    className="rounded-full px-2 py-0.5 hover:bg-petrol-dark/70"
                    onClick={() => {
                      setEditing(c.id);
                      setForm({ name: c.name, amount: c.amount, currency: c.currency, since: c.since, until: c.until, note: c.note });
                    }}
                  >
                    Bearbeiten
                  </button>
                  {c.until === null && (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-full px-2 py-0.5 hover:bg-petrol-dark/70"
                      onClick={() => void run(() => adminApi.updateFixedCost(token, c.id, { ...c, until: currentMonth }))}
                    >
                      Beenden
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full px-2 py-0.5 text-cream/70 hover:bg-rust"
                    onClick={() => window.confirm(`„${c.name}“ löschen? Es zählt dann auch in früheren Monaten nicht mehr.`) && void run(() => adminApi.deleteFixedCost(token, c.id))}
                  >
                    Löschen
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-3 border-t border-cream/20 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input className={input} required maxLength={80} placeholder="z. B. Claude Max" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Betrag / Monat
          <span className="flex gap-1">
            <input
              className={`${input} w-28`}
              type="number"
              min={0}
              step="0.01"
              required
              value={form.amount || ""}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            />
            <select className={input} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as CostCurrency })}>
              <option value="EUR">€</option>
              <option value="USD">$</option>
            </select>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          ab Monat
          <input className={input} type="month" required value={form.since} onChange={(e) => setForm({ ...form, since: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          bis Monat (leer = läuft)
          <input className={input} type="month" value={form.until ?? ""} onChange={(e) => setForm({ ...form, until: e.target.value || null })} />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
          Notiz
          <input className={input} maxLength={200} value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value || null })} />
        </label>
        <button type="submit" disabled={busy} className="rounded-full bg-bulb px-4 py-2 font-bold text-petrol-dark disabled:opacity-50">
          {editing === null ? "Hinzufügen" : "Speichern"}
        </button>
        {editing !== null && (
          <button
            type="button"
            className="rounded-full px-3 py-2 text-cream/70 hover:bg-petrol-dark/70"
            onClick={() => {
              setEditing(null);
              setForm(EMPTY_FORM(currentMonth));
            }}
          >
            Abbrechen
          </button>
        )}
      </form>
      {message && <p className="rounded-xl bg-rust px-3 py-1 text-sm font-bold">{message}</p>}
    </section>
  );
}
