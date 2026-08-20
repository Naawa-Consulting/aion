"use client";

import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip } from "@/components/ui/tooltip";

type DropdownProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  triggerAriaLabel?: string;
};

// Minimal dropdown — no positioning engine (Popper/Floating UI) since both current
// uses just need a simple absolute panel under the trigger.
export function Dropdown({ trigger, children, align = "right", triggerAriaLabel }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className={clsx(
              "absolute mt-2 min-w-[200px] rounded-xl border border-line bg-surface p-2 shadow-[var(--shadow-soft)] z-50",
              align === "right" ? "right-0" : "left-0"
            )}
            onClick={() => setOpen(false)}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type DropdownItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  // A05-R3: mismo criterio que `Button` — explicación visible (Tooltip) en vez de un `title`
  // nativo inalcanzable en un botón `disabled`.
  disabledReason?: string;
};

// Extraído de las clases que user-menu.tsx y company-switcher.tsx repetían a mano.
export const DropdownItem = React.forwardRef<HTMLButtonElement, DropdownItemProps>(
  ({ className, active, disabled, disabledReason, ...props }, ref) => {
    const item = (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={clsx(
          "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent-bg",
          active && "bg-accent-bg",
          className
        )}
        {...props}
      />
    );
    if (disabled && disabledReason) {
      return (
        <Tooltip content={disabledReason} triggerClassName="block w-full">
          {item}
        </Tooltip>
      );
    }
    return item;
  }
);

DropdownItem.displayName = "DropdownItem";
