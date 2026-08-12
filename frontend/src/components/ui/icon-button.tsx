"use client";

import clsx from "clsx";
import React from "react";

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md" | "lg";
  "aria-label": string;
};

// Extraído de las clases que ThemeToggle y el trigger de UserMenu repetían a mano en Header.tsx.
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={clsx(
        "inline-flex items-center justify-center rounded-full border border-border-control transition duration-150 hover:bg-accent-bg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        {
          sm: "h-control-sm w-control-sm",
          md: "h-control-md w-control-md",
          lg: "h-control-lg w-control-lg",
        }[size],
        className
      )}
      {...props}
    />
  )
);

IconButton.displayName = "IconButton";
