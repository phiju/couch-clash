import { CONNECTION_CONFIG, SAVED_AVATAR_ID_PATTERN } from "@couch-clash/shared";

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

/** Only well-formed credentials count (a cookie can be edited by hand). */
export function parseCredentials(raw: unknown): PlayerCredentials | null {
  if (!raw || typeof raw !== "object") return null;
  const { playerId, playerSecret } = raw as Record<string, unknown>;
  if (typeof playerId !== "string" || typeof playerSecret !== "string") return null;
  if (!/^[\w-]{1,64}$/.test(playerId) || !/^[\w-]{8,256}$/.test(playerSecret)) return null;
  return { playerId, playerSecret };
}

const credsCookie = (code: string) => `cc_player_${code.replace(/[^A-Za-z0-9]/g, "")}`;

/** Cookie string for the credentials fallback (SameSite=Lax, per room, 24 h). */
export function credentialsCookie(code: string, creds: PlayerCredentials | null, secure: boolean): string {
  const value = creds ? encodeURIComponent(`${creds.playerId}.${creds.playerSecret}`) : "";
  const maxAge = creds ? CONNECTION_CONFIG.credsCookieMaxAgeSec : 0;
  return `${credsCookie(code)}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Reads the fallback cookie from `document.cookie`. */
export function credentialsFromCookie(code: string, cookie: string): PlayerCredentials | null {
  const name = `${credsCookie(code)}=`;
  const part = cookie.split(/;\s*/).find((c) => c.startsWith(name));
  if (!part) return null;
  try {
    const [playerId, playerSecret] = decodeURIComponent(part.slice(name.length)).split(".");
    return parseCredentials({ playerId, playerSecret });
  } catch {
    return null;
  }
}

function writeCookie(code: string, creds: PlayerCredentials | null) {
  try {
    document.cookie = credentialsCookie(code, creds, window.location.protocol === "https:");
  } catch {
    // ignore
  }
}

function readCookie(code: string): PlayerCredentials | null {
  try {
    return credentialsFromCookie(code, document.cookie);
  } catch {
    return null;
  }
}

/**
 * Reconnect credentials per room: localStorage AND a fallback cookie – some
 * in-app browsers (opened from the camera's QR scanner) drop localStorage.
 */
export const playerStore = {
  get: (code: string) => parseCredentials(read<PlayerCredentials>(`player:${code}`)) ?? readCookie(code),
  set: (code: string, creds: PlayerCredentials) => {
    write(`player:${code}`, creds);
    writeCookie(code, creds);
  },
  clear: (code: string) => {
    remove(`player:${code}`);
    writeCookie(code, null);
  },
};

/** Remembers the last name/avatar so rejoining (e.g. next game night) is quick. */
export const profileStore = {
  get: <T>() => read<T>("profile"),
  set: (profile: unknown) => write("profile", profile),
};

/** Host setup (chosen categories, question counts, scoring) – remembered per device. */
export const setupStore = {
  get: <T>() => read<T>("setup"),
  set: (setup: unknown) => write("setup", setup),
};

/**
 * The player agreed to the photo note once ("Okay") – remembered per device.
 * v2: the figure is kept for next time – everyone who agreed to the old
 * note ("deleted after 24 hours") is asked again.
 */
export const photoConsentStore = {
  get: () => read<boolean>("photo-consent-v2") === true,
  set: () => write("photo-consent-v2", true),
};

/** Id of the figure kept for next time (saved on "Passt!") – the key to it, stays on this phone. */
export const savedFigureStore = {
  get: () => {
    const id = read<string>("saved-figure");
    return typeof id === "string" && SAVED_AVATAR_ID_PATTERN.test(id) ? id : null;
  },
  set: (id: string) => write("saved-figure", id),
  clear: () => remove("saved-figure"),
};

/** Last game mode on this device (Party is confirmed again in every room). */
export const modeStore = {
  get: <T>() => read<T>("game-mode"),
  set: (mode: unknown) => write("game-mode", mode),
};

/** Newest release-notes version this device has seen ("Neuigkeiten" popup, start page only). */
export const lastSeenVersionStore = {
  get: () => read<string>("lastSeenVersion"),
  set: (version: string) => write("lastSeenVersion", version),
};
