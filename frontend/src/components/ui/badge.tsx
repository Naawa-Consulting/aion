import clsx from "clsx";

type BadgeProps = {
  children: React.ReactNode;
  variant?: "neutral" | "success" | "warning" | "danger";
};

export function Badge({ children, variant = "neutral" }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variant === "neutral" && "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
        variant === "success" && "bg-[var(--color-success-soft)] text-[var(--color-success)]",
        variant === "warning" && "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
        variant === "danger" && "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      )}
    >
      {children}
    </span>
  );
}

