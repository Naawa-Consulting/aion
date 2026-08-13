// Shared number formatting for chart axes/tooltips (sibling of chart-colors.ts) —
// one convention (locale thousand separators, fixed decimals) instead of each
// chart picking its own. Empty-value placeholder comes from format.ts so charts
// and tables render the same glyph.
import { EMPTY_VALUE } from "./format";

export function formatChartNumber(value: number | string | null | undefined, decimals = 0): string {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return EMPTY_VALUE;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatChartPercent(value: number | string | null | undefined, decimals = 1): string {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "0%";
  return `${num.toFixed(decimals)}%`;
}

export function formatCurrency(
  value: number | string | null | undefined,
  currencyCode: string,
  decimals = 0
): string {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return EMPTY_VALUE;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}
