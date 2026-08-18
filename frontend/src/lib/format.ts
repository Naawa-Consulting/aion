// Single placeholder for "no value" across the whole app (tables, KPIs, chart axes).
// Previously format.ts rendered an en-dash and chart-format.ts a hyphen for the same case.
export const EMPTY_VALUE = "–";

export function formatNumber(value: number | null | undefined, decimals = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// Inverse of formatNumber/formatCurrency: strips thousands separators, currency symbols and
// stray whitespace before parsing, so pasting "$5,000.00" or "5,000" from Excel works instead
// of silently failing Number.isFinite() and getting discarded. Keeps digits, one decimal point
// and a leading minus sign; anything else (commas, currency symbols, spaces) is dropped.
export function parseNumericInput(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return raw;
  const cleaned = (raw ?? "").toString().trim().replace(/[^0-9.\-]/g, "");
  return cleaned === "" ? NaN : Number(cleaned);
}

export function formatDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
