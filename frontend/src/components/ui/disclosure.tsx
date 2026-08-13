"use client";

import React, { useState } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

type DisclosureProps = {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  toggleLabel?: string;
  as?: "h2" | "h3";
  children: React.ReactNode;
  className?: string;
};

// El control explícito Resumen→Detalle de la tesis de docs/DIRECCION-VISUAL.md §1: lo que
// está cerrado no está "más abajo", no existe hasta que se pide — salvo al imprimir, donde
// `print:block` fuerza todo visible independientemente del estado. El título vive dentro de
// un heading real (`as`, default h2) para no romper la jerarquía h1→h2→h3 de la página.
export function Disclosure({
  title,
  subtitle,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  toggleLabel,
  as: Heading = "h2",
  children,
  className,
}: DisclosureProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (value: boolean) => (onOpenChange ? onOpenChange(value) : setOpenState(value));

  return (
    <div className={className}>
      <Heading>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-3 rounded-lg py-2 text-left no-print focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span>
            <span className="block text-lg font-semibold tracking-tight text-ink">
              {toggleLabel || title}
            </span>
            {subtitle && <span className="mt-0.5 block text-sm text-muted">{subtitle}</span>}
          </span>
          <ChevronDown
            className={clsx("h-5 w-5 shrink-0 text-muted transition-transform duration-150", open && "rotate-180")}
          />
        </button>
      </Heading>
      <div className={open ? "block" : "hidden print:block"}>{children}</div>
    </div>
  );
}
