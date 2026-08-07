"use client";

import clsx from "clsx";

type ToggleChipProps = {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
};

export function ToggleChip({ active, onClick, children, className }: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full border px-2.5 py-1 text-2xs transition-colors active:scale-95 transition-transform duration-150",
        active
          ? "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-border)]/30",
        className
      )}
    >
      {children}
    </button>
  );
}
