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
