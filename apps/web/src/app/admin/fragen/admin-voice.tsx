"use client";

import { accountUsageText, type AdminVoiceResponse } from "@couch-clash/shared";
import { useEffect, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";

/**
 * The host's voice in the admin page: ElevenLabs credits this month and the
 * button "Moderator-Sprüche vertonen" (voices the library once, batch by
 * batch – about 2,400 credits the first time, free afterwards).
 */
export function AdminVoicePanel({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [status, setStatus] = useState<AdminVoiceResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi.voice(token).then(
      (s) => !cancelled && setStatus(s),
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof AdminApiError && err.status === 401) onUnauthorized();
        else setMessage(err instanceof Error ? err.message : "Fehler");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, onUnauthorized]);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      // One batch per request until everything is voiced (or nothing moves any more).
      for (let round = 0; round < 30; round++) {
        const res = await adminApi.voiceSnark(token);
        setStatus(res);
        if (!res.ok) return setMessage(res.error ?? "Fehler beim Vertonen.");
        if (res.snark.cached >= res.snark.total) return setMessage("Alle Moderator-Sprüche sind vertont.");
        if (res.generated === 0) return setMessage(`${res.failed} Sprüche konnten nicht vertont werden – später nochmal versuchen.`);
      }
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) return onUnauthorized();
      setMessage(err instanceof Error ? err.message : "Fehler");
    } finally {
      setRunning(false);
    }
  }

  const done = status ? status.snark.cached >= status.snark.total : false;
  return (
    <section className="panel flex flex-wrap items-center gap-3 p-3 text-sm" aria-label="Moderator-Stimme">
      <span className="font-bold">🎙️ Moderator</span>
      {status?.account && <span className="chip rounded-full px-3 py-1">{accountUsageText(status.account)}</span>}
      {status && (
        <span className="chip rounded-full px-3 py-1">
          Sprüche vertont: {status.snark.cached} / {status.snark.total}
        </span>
      )}
      <button
        type="button"
        onClick={() => void run()}
        disabled={running || !status || done}
        className="rounded-full border-2 border-cream/25 px-3 py-1 font-bold hover:border-cream/60 disabled:opacity-40"
      >
        {running ? "Vertont …" : "Moderator-Sprüche vertonen"}
      </button>
      {message && <span className="text-cream/80">{message}</span>}
    </section>
  );
}
