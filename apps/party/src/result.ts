import type { ErrorCode } from "@couch-clash/shared";

export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorCode };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(error: ErrorCode): Result<T> => ({ ok: false, error });
