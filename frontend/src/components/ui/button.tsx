"use client";

import clsx from "clsx";
import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading = false, disabled, children, ...props }, ref) => {
    const classes = clsx(
      "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 active:scale-[0.97]",
      "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none disabled:active:scale-100",
      {
        // Blanco sobre --accent/--bad falla WCAG AA en modo oscuro (2.42:1 / 3.24:1, verificado) —
        // en ese modo el texto pasa a --plane (el tono más oscuro disponible), 6.10-8.15:1.
        primary: "bg-accent text-white dark:text-plane hover:opacity-90",
        secondary: "bg-accent-bg text-accent hover:opacity-90",
        ghost: "bg-transparent text-ink hover:bg-accent-bg",
        danger: "bg-bad text-white dark:text-plane hover:opacity-90",
      }[variant],
      {
        sm: "h-control-sm text-sm px-3",
        md: "h-control-md text-sm px-4",
        lg: "h-control-lg text-base px-5",
      }[size],
      className
    );
    return (
      <button ref={ref} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
        {loading && (
          <span
            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
