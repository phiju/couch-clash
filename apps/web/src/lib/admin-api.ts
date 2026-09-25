/** Admin API client. The token lives in sessionStorage only (never in the code). */
import type { AdminQuestionsResponse, AdminStatusRequest } from "@couch-clash/shared";
import { PARTY_HTTP_URL } from "./config";

const TOKEN_KEY = "couch-clash:admin-token";

export function loadAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let memoryToken: string | null = null;
const listeners = new Set<() => void>();

export function saveAdminToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode – the token is kept in memory only
  }
  for (const l of listeners) l();
}

/** For useSyncExternalStore. */
export const adminTokenStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => loadAdminToken() ?? memoryToken,
  /** Server render: unknown yet. */
  getServer: () => undefined,
};

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PARTY_HTTP_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new AdminApiError(0, "Server nicht erreichbar.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new AdminApiError(res.status, body.error ?? `Fehler ${res.status}`);
  return body as T;
}

export const adminApi = {
  list: (token: string) => call<AdminQuestionsResponse>(token, "/api/admin/questions"),
  setStatus: (token: string, req: AdminStatusRequest) =>
    call<{ ok: true; replacing: number }>(token, "/api/admin/questions/status", { method: "POST", body: JSON.stringify(req) }),
  edit: (token: string, id: string, payload: unknown) =>
    call<{ ok: true }>(token, `/api/admin/questions/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ payload }) }),
};
