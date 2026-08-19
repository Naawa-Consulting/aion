import React from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  wrapperClassName?: string;
};

// Contenedor con scroll-x propio (nunca deja que la tabla desborde la página) + borde consistente.
export function Table({ className, wrapperClassName, ...props }: TableProps) {
  return (
    <div className={clsx("overflow-x-auto rounded-xl border border-line", wrapperClassName)}>
      <table className={clsx("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={clsx("bg-surface-2", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={clsx("border-b border-line last:border-0", className)} {...props} />;
}

type ThProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  /** Fase 8 A6: pass both to make this header clickable-sortable; omit for a plain header. */
  sortDirection?: "asc" | "desc" | null;
  onSort?: () => void;
};

// scope="col" por defecto — hoy hay 38 <th> en la app y ninguno lo tiene.
export function Th({ className, scope = "col", sortDirection, onSort, children, ...props }: ThProps) {
  return (
    <th
      scope={scope}
      className={clsx(
        "px-3 py-2 text-left text-2xs font-medium uppercase tracking-wide text-muted",
        className
      )}
      {...props}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {children}
          {sortDirection === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : sortDirection === "desc" ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronsUpDown className="h-3 w-3 opacity-40" />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={clsx("px-3 py-2 text-ink", className)} {...props} />;
}
