"use client";

import React, { useId, useRef } from "react";
import clsx from "clsx";

type TabItem = {
  id: string;
  label: string;
  content: React.ReactNode;
};

type TabsProps = {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

// Reemplaza el scroll vertical de N secciones por un panel a la vez. Los panels inactivos
// quedan montados y ocultos (`hidden`), no desmontados — así una gráfica de recharts ya
// medida no tiene que re-layoutear desde cero al reactivar su tab, y `print:block` puede
// forzarlos todos visibles al imprimir sin re-render.
export function Tabs({ items, active, onChange, className }: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (delta: number) => {
    const idx = items.findIndex((item) => item.id === active);
    const next = items[(idx + delta + items.length) % items.length];
    onChange(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(items[0].id);
      tabRefs.current[items[0].id]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const last = items[items.length - 1];
      onChange(last.id);
      tabRefs.current[last.id]?.focus();
    }
  };

  return (
    <div className={className}>
      {/* Horizontal scroll lives on this outer wrapper, deliberately separate from the
          bordered/tab row below (the active tab's `-mb-px`, merging its underline with the
          row's border, collapses into a sub-pixel scrollHeight/clientHeight mismatch on
          whatever element carries both the border and the overflow). `overflow-y-hidden` is
          the real fix, not just tidiness: per spec, `overflow-x: auto` forces the other axis to
          compute as `auto` too whenever it's `visible` — an explicit `overflow-y: visible`
          does NOT opt out of that. `hidden` is not `visible`, so the forcing rule never
          applies, which makes this immune to sub-pixel rounding (font hinting/zoom) even where
          the structural separation above still leaves a fractional mismatch. */}
      <div className="overflow-x-auto overflow-y-hidden no-print">
        <div role="tablist" className="flex gap-1 border-b border-line" onKeyDown={handleKeyDown}>
          {items.map((item) => {
            const selected = item.id === active;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  tabRefs.current[item.id] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(item.id)}
                className={clsx(
                  "-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition duration-150",
                  selected ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="pt-4">
        {items.map((item) => (
          <div
            key={item.id}
            role="tabpanel"
            id={`${baseId}-panel-${item.id}`}
            aria-labelledby={`${baseId}-tab-${item.id}`}
            className={item.id === active ? "block" : "hidden print:block print:pt-6"}
          >
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}
