import React from "react";
import clsx from "clsx";

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

type ThProps = React.ThHTMLAttributes<HTMLTableCellElement>;

// scope="col" por defecto — hoy hay 38 <th> en la app y ninguno lo tiene.
export function Th({ className, scope = "col", ...props }: ThProps) {
  return (
    <th
      scope={scope}
      className={clsx(
        "px-3 py-2 text-left text-2xs font-medium uppercase tracking-wide text-muted",
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={clsx("px-3 py-2 text-ink", className)} {...props} />;
}
