import { useRef } from "react";

// Categorical palette validated for CVD-safe adjacent pairs in both light/dark
// (see .claude skill "dataviz" / references/palette.md). Order is the safety
// mechanism — never reassign by index or cycle past slot 8.
const CATEGORICAL_LIGHT = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

const CATEGORICAL_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
] as const;

const OVERFLOW_LIGHT = "#898781";
const OVERFLOW_DARK = "#898781";

export const CHART_STATUS_LIGHT = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

export const CHART_STATUS_DARK = CHART_STATUS_LIGHT;

export function categoricalPalette(isDark: boolean): readonly string[] {
  return isDark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
}

export function chartColor(index: number, isDark: boolean): string {
  const palette = categoricalPalette(isDark);
  if (index < palette.length) return palette[index];
  // Beyond 8 distinct series, fold to a shared neutral rather than cycling
  // hues (cycling breaks the validated adjacent-pair CVD guarantee).
  return isDark ? OVERFLOW_DARK : OVERFLOW_LIGHT;
}

/**
 * Assigns a stable color per name given a fixed, deterministic ordering
 * (e.g. names sorted once upstream) — never re-derive order from a hash or
 * from render-time filtering, or colors will repaint as filters change.
 */
export function assignCategoricalColors(orderedNames: string[], isDark: boolean): Record<string, string> {
  const map: Record<string, string> = {};
  orderedNames.forEach((name, index) => {
    map[name] = chartColor(index, isDark);
  });
  return map;
}

/**
 * Sticky group→color assignment across re-fetches (date range/filter changes) — fixes the
 * repaint bug `assignCategoricalColors` has when re-sorting a *filtered* list: dropping one
 * name shifts every later name's index. Here the index, once assigned, never changes; a
 * name that drops out of view and comes back later gets its original color back. Reset the
 * registry (pass a new `resetKey`, e.g. the selected model id) when the identity of "what a
 * name refers to" changes, not on every data refresh.
 */
export function useStableCategoricalColor(resetKey: unknown) {
  const registryRef = useRef<Map<string, number>>(new Map());
  const resetKeyRef = useRef(resetKey);
  if (resetKeyRef.current !== resetKey) {
    registryRef.current = new Map();
    resetKeyRef.current = resetKey;
  }
  return function colorFor(name: string, isDark: boolean): string {
    const registry = registryRef.current;
    if (!registry.has(name)) registry.set(name, registry.size);
    return chartColor(registry.get(name)!, isDark);
  };
}
