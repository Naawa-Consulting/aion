import clsx from "clsx";

type BadgeProps = {
  children: React.ReactNode;
  variant?: "neutral" | "accent" | "success" | "warning" | "danger";
  className?: string;
};

export function Badge({ children, variant = "neutral", className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        // "neutral" es gris de verdad — antes reusaba el color de acento, lo que lo hacía leerse
        // como un estado activo. "accent" conserva ese look para quien lo necesite a propósito.
        variant === "neutral" && "bg-line text-muted",
        variant === "accent" && "bg-accent-bg text-accent",
        variant === "success" && "bg-good-bg text-good",
        variant === "warning" && "bg-warn-bg text-warn",
        variant === "danger" && "bg-bad-bg text-bad",
        className
      )}
    >
      {children}
    </span>
  );
}
