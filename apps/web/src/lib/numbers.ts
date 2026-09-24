/**
 * Parses what people type on a German phone keyboard:
 * "3,5" → 3.5, "1.000" → 1000, "1.234,5" → 1234.5, "42.195" (single dot
 * with 3 decimals) → 42195 in German reading – so we only treat dots as
 * thousands separators when the number has the grouped shape.
 */
export function parseGermanNumber(input: string): number | null {
  let s = input.trim().replace(/\s|'/g, "").replace(/^\+/, "");
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatNumber(value: number, format: "number" | "year" = "number"): string {
  if (format === "year") return String(value);
  return value.toLocaleString("de-DE", { maximumFractionDigits: 3 });
}
