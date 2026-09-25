import type { ContentEntry, ModuleInitOptions } from "@couch-clash/shared";
import type { z } from "zod";

/**
 * The questions a category may play: static content + valid extra content
 * (AI-generated), minus blocked ids (quarantined / removed). Invalid extra
 * items are skipped, never played.
 */
export function playablePool<T extends { id: string }>(
  staticPool: readonly T[],
  schema: z.ZodType<T>,
  options: Pick<ModuleInitOptions, "blockedContentIds" | "extraContent">,
): T[] {
  const extra = (options.extraContent ?? []).flatMap((raw) => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  const ids = new Set(staticPool.map((q) => q.id));
  const merged = [...staticPool, ...extra.filter((q) => !ids.has(q.id))];
  const blocked = options.blockedContentIds;
  return blocked && blocked.size > 0 ? merged.filter((q) => !blocked.has(q.id)) : merged;
}

export function parseWith<T>(schema: z.ZodType<T>, raw: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ") };
}

/** Admin catalog: static + valid extra items as ContentEntry. */
export function listEntries<T extends { id: string }>(
  staticPool: readonly T[],
  schema: z.ZodType<T>,
  extraContent: readonly unknown[] | undefined,
  toEntry: (item: T) => ContentEntry,
): ContentEntry[] {
  return playablePool(staticPool, schema, { extraContent }).map(toEntry);
}
