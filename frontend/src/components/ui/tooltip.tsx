"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
  // Which side of the trigger the tooltip opens toward.
  side?: "top" | "bottom";
  // `align="end"` anchors the tooltip's right edge to the trigger instead of centering it — needed
  // when the trigger sits at the right edge of a container (e.g. the last column of a
  // right-aligned table).
  align?: "center" | "end";
  // Overrides the wrapping trigger `<span>`'s display class (default `inline-flex`, always kept
  // alongside `relative`) — e.g. `"block w-full"` when the child is a block-level, full-width
  // control (a disabled `DropdownItem`) that would otherwise collapse to content width.
  triggerClassName?: string;
};

// Popover simple en hover/focus, sin librería de posicionamiento (mismo criterio que Dropdown) —
// para la jerga de MMM. Fase 6 bugfix: un trigger dentro de una tabla (envuelta en
// `overflow-x-auto`, ver components/ui/table.tsx) rompía esto de raíz — CSS computa ese wrapper
// como `overflow: auto auto` (ambos ejes, no solo el horizontal), así que CUALQUIER contenido que
// se saliera de su caja —posicionado con `absolute`, sin importar hacia qué lado— quedaba
// alcanzable solo scrolleando esa dirección, algo imposible de hacer sin antes mover el cursor
// fuera del trigger (que cierra el tooltip). Cambiar de `bottom-full` a `top-full` (intento
// anterior) solo movió el problema del eje vertical de "arriba" a "abajo" — no lo resolvió. La
// única solución real es no ser descendiente del DOM del contenedor con overflow: el popover se
// renderiza vía portal a `document.body`, posicionado en coordenadas de viewport (`position:
// fixed`) calculadas desde `getBoundingClientRect()` del trigger — inmune al overflow/clipping de
// cualquier ancestro.
export function Tooltip({ content, children, className, side = "top", align = "center", triggerClassName }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({
      top: side === "bottom" ? rect.bottom + 8 : rect.top - 8,
      left: align === "end" ? rect.right : rect.left + rect.width / 2,
    });
    setOpen(true);
  };
  const hide = () => setOpen(false);

  // A05-R4: hover/focus solo no sirve en touch (sin puntero, sin :hover real) — el trigger también
  // alterna al tocar/hacer clic. En escritorio esto puede cerrar un tooltip que el hover acaba de
  // abrir; inofensivo. Con el toggle por toque no hay `mouseleave` que lo cierre, así que un clic
  // fuera del trigger y del popover portalado lo cierra explícitamente.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  return (
    <span
      ref={triggerRef}
      className={clsx("relative", triggerClassName ?? "inline-flex")}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={() => setOpen((o) => !o)}
    >
      {React.cloneElement(children, { "aria-describedby": id })}
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            id={id}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform: `translate(${align === "end" ? "-100%" : "-50%"}, ${side === "bottom" ? "0%" : "-100%"})`,
            }}
            className={clsx(
              "pointer-events-none z-50 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink shadow-[var(--shadow-soft)]",
              className
            )}
          >
            {content}
          </span>,
          document.body
        )}
    </span>
  );
}
