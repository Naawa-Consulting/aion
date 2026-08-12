"use client";

import React, { useId, useState } from "react";
import clsx from "clsx";

type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
};

// Popover simple en hover/focus, sin librería de posicionamiento (mismo criterio que Dropdown) —
// para la jerga de MMM. Siempre se ancla arriba del trigger; si algún día hace falta otra
// posición, es un prop `side` nuevo, no una reescritura.
export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {React.cloneElement(children, { "aria-describedby": id })}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={clsx(
            "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink shadow-[var(--shadow-soft)]",
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
