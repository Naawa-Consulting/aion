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
        // Single `transition` — see button.tsx: two transition-property utilities
        // cancelled each other out and the color never animated.
        "rounded-full border px-2.5 py-1 text-2xs transition duration-150 active:scale-95",
        active
          ? "border-transparent bg-accent-bg text-accent"
          : "border-border-control text-muted hover:bg-surface-2",
        className
      )}
    >
      {children}
    </button>
  );
}
