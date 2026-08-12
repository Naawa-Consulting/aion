import React from "react";
import clsx from "clsx";

type StatCardProps = {
  label: string;
  value: string;
  size?: "3xl" | "4xl";
  trend?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
};

// Regla dura de docs/DIRECCION-VISUAL.md §3: etiqueta y valor nunca comparten tamaño (a
// diferencia de CardHeader, donde ambos usaban text-lg font-semibold).
export function StatCard({ label, value, size = "3xl", trend, icon, className }: StatCardProps) {
  return (
    <div className={clsx("glass-card p-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        {icon}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={clsx("font-semibold tabular-nums text-ink", size === "3xl" ? "text-3xl" : "text-4xl")}>
          {value}
        </span>
        {trend}
      </div>
    </div>
  );
}
