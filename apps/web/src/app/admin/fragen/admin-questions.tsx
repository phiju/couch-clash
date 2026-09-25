"use client";

import { CATEGORY_METAS, getCategoryMeta } from "@couch-clash/games/meta";
import {
  QUICK_FILTER_LABELS,
  QUICK_FILTERS,
  GAME_MODE_INFO,
  GAME_MODES,
  type AdminQuestion,
  type GameMode,
  type AdminQuestionsResponse,
  type QuestionStatus,
  type QuickFilter,
} from "@couch-clash/shared";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, Screen } from "@/components/ui";
import { AdminApiError, adminApi, adminTokenStore, saveAdminToken } from "@/lib/admin-api";
import { applyView, DEFAULT_VIEW, quickCounts, scoreOf, STATUS_LABELS, toCsv, type AdminView, type SortKey } from "@/lib/admin-view";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "id", label: "ID" },
  { key: "categoryId", label: "Kategorie" },
  { key: "text", label: "Frage", className: "min-w-[18rem]" },
  { key: "difficulty", label: "Schw." },
  { key: "plays", label: "Gespielt" },
  { key: "score", label: "Richtig / Ø Fehler" },
  { key: "avgResponseMs", label: "Ø Zeit" },
  { key: "thumbs", label: "👍 / 👎" },
  { key: "reports", label: "Meld." },
  { key: "status", label: "Status" },
  { key: "lastPlayedAt", label: "Zuletzt" },
];

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)} %`);
const date = (t: number | null) =>
  t ? new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";

type Item = { id: string; categoryId: string };

export function AdminQuestionsPage() {
  const token = useSyncExternalStore(adminTokenStore.subscribe, adminTokenStore.get, adminTokenStore.getServer);
  const logout = useCallback((message?: string) => {
    saveAdminToken(null);
    if (message) window.alert(message);
  }, []);

  if (token === undefined) return <Screen />;
  if (!token) return <TokenForm onSubmit={(t) => saveAdminToken(t)} />;
  return <AdminTable token={token} onLogout={logout} />;
}

function TokenForm({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Screen dim="soft" className="justify-center">
      <form
        className="panel flex w-full max-w-md flex-col gap-5 p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <h1 className="text-3xl font-bold">Fragen-Admin 🔒</h1>
        <label className="flex flex-col gap-2 text-lg">
          Admin-Token
          <input
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="rounded-xl border-2 border-bulb/60 bg-petrol-dark/80 px-4 py-3 text-cream outline-none focus:border-bulb"
          />
        </label>
        <p className="text-sm text-cream/70">Wird nur in diesem Tab gespeichert (sessionStorage).</p>
        <Button type="submit">Anmelden</Button>
      </form>
    </Screen>
  );
}

function AdminTable({ token, onLogout }: { token: string; onLogout: (message?: string) => void }) {
  const [data, setData] = useState<AdminQuestionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<AdminView>(DEFAULT_VIEW);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminQuestion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi.list(token).then(
      (next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
        setBusy(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setBusy(false);
        if (err instanceof AdminApiError && err.status === 401) return onLogout("Token ungültig.");
        setError(err instanceof Error ? err.message : "Fehler");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, onLogout, reloadKey]);

  const load = () => {
    setBusy(true);
    setReloadKey((k) => k + 1);
  };

  const rows = useMemo(() => (data ? applyView(data.questions, view) : []), [data, view]);
  const counts = useMemo(() => quickCounts(data?.questions ?? [], QUICK_FILTERS), [data]);
  const selectedItems = useMemo<Item[]>(
    () => (data?.questions ?? []).filter((q) => selected.has(q.id)).map((q) => ({ id: q.id, categoryId: q.categoryId })),
    [data, selected],
  );

  async function setStatus(items: Item[], status: QuestionStatus) {
    if (items.length === 0) return;
    if (status === "removed") {
      const text =
        items.length === 1
          ? "Diese Frage rauswerfen? Sie wird nicht mehr gespielt und automatisch durch eine neue ersetzt."
          : `${items.length} Fragen rauswerfen? Sie werden nicht mehr gespielt und automatisch ersetzt.`;
      if (!window.confirm(text)) return;
    }
    setBusy(true);
    try {
      const res = await adminApi.setStatus(token, { items, status });
      setSelected(new Set());
      setNotice(res.replacing > 0 ? `Ersatz wird erzeugt (${res.replacing}) – in ein paar Sekunden neu laden.` : "Gespeichert.");
      load();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) return onLogout("Token ungültig.");
      setError(err instanceof Error ? err.message : "Fehler");
      setBusy(false);
    }
  }

  function exportCsv() {
    const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fragen-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const toggleSort = (key: SortKey) =>
    setView((v) => ({ ...v, sort: key, desc: v.sort === key ? !v.desc : key !== "id" && key !== "text" && key !== "categoryId" }));
  const allSelected = rows.length > 0 && rows.every((q) => selected.has(q.id));
  const failedLog = data?.generationLog.filter((l) => !l.ok) ?? [];

  return (
    <Screen className="max-w-[1800px] !items-stretch gap-4 text-base">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Fragen-Admin</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {data && (
            <span className="chip rounded-full px-3 py-1">
              Generiert heute: {data.generationsToday} / {data.dailyGenerationLimit}
            </span>
          )}
          <button type="button" onClick={load} className="rounded-full px-3 py-1 font-bold hover:bg-petrol-dark/70" disabled={busy}>
            {busy ? "Lädt …" : "↻ Neu laden"}
          </button>
          <button type="button" onClick={() => onLogout()} className="rounded-full px-3 py-1 text-cream/70 hover:bg-petrol-dark/70">
            Abmelden
          </button>
        </div>
      </header>

      {error && <p className="rounded-xl bg-rust px-4 py-2 font-bold">{error}</p>}
      {notice && (
        <p className="flex items-center justify-between rounded-xl bg-petrol px-4 py-2 font-bold">
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="Schließen">
            ✕
          </button>
        </p>
      )}
      {failedLog.length > 0 && (
        <details className="panel p-3 text-sm">
          <summary className="cursor-pointer font-bold">⚠️ Fehler beim Generieren ({failedLog.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {failedLog.map((l, i) => (
              <li key={i}>
                {date(l.createdAt)} · {l.categoryId} · {l.replacesId ?? "–"}: {l.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {QUICK_FILTERS.map((f: QuickFilter) => (
          <button
            key={f}
            type="button"
            onClick={() => setView((v) => ({ ...v, quick: v.quick === f ? null : f }))}
            className={`flex items-center gap-2 rounded-full border-2 px-3 py-1 text-sm font-bold ${
              view.quick === f ? "border-bulb bg-bulb/25" : "border-cream/25 bg-petrol-dark/70 hover:border-cream/60"
            }`}
          >
            {QUICK_FILTER_LABELS[f]}
            <span className={`rounded-full px-2 text-xs ${f === "quarantined" && counts[f] > 0 ? "bg-rust" : "bg-cream/15"}`}>
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={view.category ?? ""}
          onChange={(e) => setView((v) => ({ ...v, category: e.target.value || null }))}
          className="rounded-xl border-2 border-cream/25 bg-petrol-dark px-3 py-2"
          aria-label="Kategorie"
        >
          <option value="">Alle Kategorien</option>
          {CATEGORY_METAS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.emoji} {m.name}
            </option>
          ))}
        </select>
        <select
          value={view.mode ?? ""}
          onChange={(e) => setView((v) => ({ ...v, mode: (e.target.value || null) as GameMode | null }))}
          className="rounded-xl border-2 border-cream/25 bg-petrol-dark px-3 py-2"
          aria-label="Spielmodus"
        >
          <option value="">Alle Modi</option>
          {GAME_MODES.map((m) => (
            <option key={m} value={m}>
              {GAME_MODE_INFO[m].emoji} {GAME_MODE_INFO[m].label}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Suchen (Text, Antwort, ID, Tag) …"
          value={view.search}
          onChange={(e) => setView((v) => ({ ...v, search: e.target.value }))}
          className="min-w-[16rem] flex-1 rounded-xl border-2 border-cream/25 bg-petrol-dark px-3 py-2"
        />
        <span className="text-sm text-cream/70">{rows.length} Fragen</span>
        <button type="button" onClick={exportCsv} className="rounded-full border-2 border-cream/25 px-3 py-1.5 text-sm font-bold hover:border-cream/60">
          CSV exportieren
        </button>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border-2 border-bulb bg-petrol-dark/95 px-4 py-2 font-bold">
          <span>{selected.size} ausgewählt</span>
          <button type="button" className="rounded-full bg-petrol px-3 py-1" onClick={() => void setStatus(selectedItems, "active")}>
            Wieder aktivieren
          </button>
          <button type="button" className="rounded-full bg-rust px-3 py-1" onClick={() => void setStatus(selectedItems, "removed")}>
            Rauswerfen
          </button>
          <button type="button" className="text-cream/70" onClick={() => setSelected(new Set())}>
            Auswahl aufheben
          </button>
        </div>
      )}

      <div className="panel overflow-x-auto p-0">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-petrol-dark/80 text-left">
            <tr>
              <th className="p-2">
                <input
                  type="checkbox"
                  aria-label="Alle auswählen"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((q) => q.id)))}
                />
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} className={`p-2 whitespace-nowrap ${c.className ?? ""}`}>
                  <button type="button" onClick={() => toggleSort(c.key)} className="font-bold hover:text-bulb">
                    {c.label} {view.sort === c.key ? (view.desc ? "▼" : "▲") : ""}
                  </button>
                </th>
              ))}
              <th className="p-2">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id} className="border-t border-cream/10 align-top hover:bg-petrol-dark/40">
                <td className="p-2">
                  <input
                    type="checkbox"
                    aria-label={`${q.id} auswählen`}
                    checked={selected.has(q.id)}
                    onChange={() =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (next.has(q.id)) next.delete(q.id);
                        else next.add(q.id);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="p-2 font-mono text-xs whitespace-nowrap">
                  {q.id}
                  {q.generated && <span className="ml-1 rounded bg-bulb px-1 text-brown">neu</span>}
                </td>
                <td className="p-2 whitespace-nowrap">{getCategoryMeta(q.categoryId)?.emoji ?? ""} {getCategoryMeta(q.categoryId)?.name ?? q.categoryId}</td>
                <td className="p-2">
                  <div>{q.text}</div>
                  <div className="text-cream/70">✔ {q.answer}</div>
                </td>
                <td className="p-2 text-center">{q.difficulty}</td>
                <td className="p-2 text-right">{q.plays}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  {q.avgErrorPct !== null ? `Ø ${pct(q.avgErrorPct)} daneben` : pct(scoreOf(q))}
                </td>
                <td className="p-2 text-right whitespace-nowrap">{q.avgResponseMs === null ? "–" : `${(q.avgResponseMs / 1000).toFixed(1)} s`}</td>
                <td className="p-2 text-center whitespace-nowrap">
                  {q.thumbsUp} / {q.thumbsDown}
                </td>
                <td className="p-2 text-center">{q.reports}</td>
                <td className="p-2 whitespace-nowrap">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      q.status === "active" ? "bg-petrol" : q.status === "quarantined" ? "bg-orange" : "bg-rust"
                    }`}
                  >
                    {STATUS_LABELS[q.status]}
                  </span>
                </td>
                <td className="p-2 whitespace-nowrap">{date(q.lastPlayedAt)}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {q.status !== "active" && (
                      <button type="button" className="rounded-full bg-petrol px-2 py-0.5" onClick={() => void setStatus([q], "active")}>
                        Wieder aktivieren
                      </button>
                    )}
                    {q.status !== "removed" && (
                      <button type="button" className="rounded-full bg-rust px-2 py-0.5" onClick={() => void setStatus([q], "removed")}>
                        Rauswerfen
                      </button>
                    )}
                    {q.generated && (
                      <button type="button" className="rounded-full border border-cream/40 px-2 py-0.5" onClick={() => setEditing(q)}>
                        Bearbeiten
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {data && rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="p-6 text-center text-cream/70">
                  Keine Fragen für diese Auswahl.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditDialog
          question={editing}
          onCancel={() => setEditing(null)}
          onSave={async (payload) => {
            await adminApi.edit(token, editing.id, payload);
            setEditing(null);
            setNotice("Gespeichert.");
            load();
          }}
        />
      )}
    </Screen>
  );
}

/** Generic JSON editor – validated on the server with the category's schema. */
function EditDialog({
  question,
  onCancel,
  onSave,
}: {
  question: AdminQuestion;
  onCancel: () => void;
  onSave: (payload: unknown) => Promise<void>;
}) {
  const [text, setText] = useState(() => JSON.stringify(question.payload, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal>
      <form
        className="panel flex w-full max-w-2xl flex-col gap-3 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          let payload: unknown;
          try {
            payload = JSON.parse(text);
          } catch {
            return setError("Kein gültiges JSON.");
          }
          setSaving(true);
          try {
            await onSave(payload);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Fehler");
            setSaving(false);
          }
        }}
      >
        <h2 className="text-2xl font-bold">Frage bearbeiten · {question.id}</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={16}
          className="rounded-xl border-2 border-cream/25 bg-petrol-dark p-3 font-mono text-sm"
        />
        {error && <p className="rounded-xl bg-rust px-3 py-2 text-sm font-bold">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 font-bold hover:bg-petrol-dark/70">
            Abbrechen
          </button>
          <Button type="submit" disabled={saving} className="!px-6 !py-2 !text-lg">
            {saving ? "Speichert …" : "Speichern"}
          </Button>
        </div>
      </form>
    </div>
  );
}
