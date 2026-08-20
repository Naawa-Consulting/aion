"use client";

import clsx from "clsx";
import React from "react";
import { Tooltip } from "@/components/ui/tooltip";

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md" | "lg";
  "aria-label": string;
  // A05-R3: mismo criterio que `Button` — explicación visible (Tooltip) en vez de un `title`
  // nativo inalcanzable en un botón `disabled`.
  disabledReason?: string;
};

// Extraído de las clases que ThemeToggle y el trigger de UserMenu repetían a mano en Header.tsx.
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", disabled, disabledReason, ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
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
    );
    if (disabled && disabledReason) {
      return <Tooltip content={disabledReason}>{button}</Tooltip>;
    }
    return button;
  }
);

IconButton.displayName = "IconButton";
