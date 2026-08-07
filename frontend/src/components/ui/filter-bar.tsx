import React from "react";
import clsx from "clsx";
import { Eyebrow } from "@/components/ui/eyebrow";

type FilterBarProps = {
  children: React.ReactNode;
  className?: string;
};

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div
      className={clsx(
        "mb-4 flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-[var(--color-border)] pb-3",
        className
      )}
    >
      {children}
    </div>
  );
}

type FilterFieldProps = {
  label: string;
  children: React.ReactNode;
  className?: string;
};

export function FilterField({ label, children, className }: FilterFieldProps) {
  return (
    <label className={clsx("flex flex-col", className)}>
      <Eyebrow className="mb-1 leading-none">{label}</Eyebrow>
      {children}
    </label>
  );
}
