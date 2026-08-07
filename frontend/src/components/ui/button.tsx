"use client";

import clsx from "clsx";
import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    const classes = clsx(
      "rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.97] transition-transform duration-150",
      {
        primary: "bg-[var(--color-accent)] text-white hover:opacity-90",
        secondary: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
        ghost: "bg-transparent text-[var(--color-foreground)] hover:bg-[var(--color-accent-soft)]",
        danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
      }[variant],
      {
        sm: "text-sm px-3 py-1.5",
        md: "text-sm px-4 py-2",
      }[size],
      className
    );
    return <button ref={ref} className={classes} {...props} />;
  }
);

Button.displayName = "Button";

