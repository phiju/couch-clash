import type { CategoryMeta } from "@couch-clash/shared";

/** Known category options only, missing ones with their default (CategoryMeta.options). */
export function normalizeCategoryOptions(
  meta: Pick<CategoryMeta, "options">,
  raw: Readonly<Record<string, unknown>> | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const option of meta.options ?? []) {
    const value = raw?.[option.id];
    out[option.id] = typeof value === "boolean" ? value : option.default;
  }
  return out;
}
