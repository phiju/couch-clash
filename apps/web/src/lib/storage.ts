/**
 * localStorage helpers. Every access is wrapped in try/catch because storage
 * can be unavailable (private mode, blocked site data).
 */
const PREFIX = "couchclash";

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(`${PREFIX}:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(value));
  } catch {
    // ignore – the session still works, it just can't be restored after reload
  }
}

function remove(key: string) {
  try {
    window.localStorage.removeItem(`${PREFIX}:${key}`);
  } catch {
    // ignore
  }
}

export const hostTokenStore = {
  get: (code: string) => read<string>(`host:${code}`),
  set: (code: string, token: string) => write(`host:${code}`, token),
};

export interface PlayerCredentials {
  playerId: string;
  playerSecret: string;
}

export const playerStore = {
  get: (code: string) => read<PlayerCredentials>(`player:${code}`),
  set: (code: string, creds: PlayerCredentials) => write(`player:${code}`, creds),
  clear: (code: string) => remove(`player:${code}`),
};

/** Remembers the last name/avatar so rejoining (e.g. next game night) is quick. */
export const profileStore = {
  get: <T>() => read<T>("profile"),
  set: (profile: unknown) => write("profile", profile),
};
