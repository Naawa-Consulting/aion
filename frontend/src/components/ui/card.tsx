import React from "react";
import clsx from "clsx";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  padding?: "sm" | "md" | "lg";
};

export function Card({ className, padding = "md", ...props }: CardProps) {
  return (
    <div
      className={clsx(
        "glass-card", // relies on global class
        padding === "sm" && "p-4",
        padding === "md" && "p-6",
        padding === "lg" && "p-8",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      {subtitle && <p className="text-sm text-[var(--color-muted)]">{subtitle}</p>}
    </div>
  );
}

