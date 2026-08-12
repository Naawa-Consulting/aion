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

export function CardHeader({
  title,
  subtitle,
  as: Heading = "h3",
}: {
  title: string;
  subtitle?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className="mb-4">
      <Heading className="text-lg font-semibold tracking-tight text-ink">{title}</Heading>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

