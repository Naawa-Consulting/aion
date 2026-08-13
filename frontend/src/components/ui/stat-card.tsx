import React from "react";
import clsx from "clsx";

type StatCardProps = {
  label: string;
  value: string;
  size?: "lg" | "3xl" | "4xl";
  trend?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
};

const VALUE_SIZE = {
  // "lg" is for compact metadata tiles (row/column counts, dates) — not a KPI hero number, so it
  // skips straight to the smallest step of the type scale instead of 3xl/4xl.
  lg: "text-lg",
  "3xl": "text-3xl",
  "4xl": "text-4xl",
} as const;

// Regla dura de docs/DIRECCION-VISUAL.md §3: etiqueta y valor nunca comparten tamaño (a
// diferencia de CardHeader, donde ambos usaban text-lg font-semibold).
export function StatCard({ label, value, size = "3xl", trend, icon, className }: StatCardProps) {
  return (
    <div className={clsx("glass-card p-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        {icon}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={clsx("font-semibold tabular-nums text-ink", VALUE_SIZE[size])}>{value}</span>
        {trend}
      </div>
    </div>
  );
}
