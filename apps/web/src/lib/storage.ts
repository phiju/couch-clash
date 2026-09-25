import { SAVED_AVATAR_ID_PATTERN } from "@couch-clash/shared";

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

/** Host setup (chosen categories, question counts, scoring) – remembered per device. */
export const setupStore = {
  get: <T>() => read<T>("setup"),
  set: (setup: unknown) => write("setup", setup),
};

/** The player agreed to the photo note once ("Okay") – remembered per device. */
export const photoConsentStore = {
  get: () => read<boolean>("photo-consent") === true,
  set: () => write("photo-consent", true),
};

/** Id of the figure saved with "Figur behalten" – the key to it, stays on this phone. */
export const savedFigureStore = {
  get: () => {
    const id = read<string>("saved-figure");
    return typeof id === "string" && SAVED_AVATAR_ID_PATTERN.test(id) ? id : null;
  },
  set: (id: string) => write("saved-figure", id),
  clear: () => remove("saved-figure"),
};

/** Host lobby: settings column open or collapsed – remembered per device. */
export const lobbySettingsStore = {
  get: () => read<boolean>("lobby-settings-open"),
  set: (open: boolean) => write("lobby-settings-open", open),
};
