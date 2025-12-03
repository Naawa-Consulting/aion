import React from "react";
import clsx from "clsx";

type FilterBarProps = {
  children: React.ReactNode;
  className?: string;
};

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div
      className={clsx(
        "mb-4 flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-black/5 pb-3",
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
    <label className={clsx("flex flex-col text-[11px] uppercase text-black/45", className)}>
      <span className="mb-1 leading-none tracking-wide">{label}</span>
      {children}
    </label>
  );
}
