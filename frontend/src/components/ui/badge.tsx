import clsx from "clsx";

type BadgeProps = {
  children: React.ReactNode;
  variant?: "neutral" | "success" | "warning";
};

export function Badge({ children, variant = "neutral" }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variant === "neutral" && "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
        variant === "success" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
        variant === "warning" && "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-100"
      )}
    >
      {children}
    </span>
  );
}

