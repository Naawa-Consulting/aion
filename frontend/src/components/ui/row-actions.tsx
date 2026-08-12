import React from "react";
import clsx from "clsx";

type RowActionsProps = {
  children: React.ReactNode;
  className?: string;
};

// Clúster de acciones con espaciado/área de clic consistente — hoy "Delete" queda a ~8px de
// "Update File" en las tarjetas de dataset.
export function RowActions({ children, className }: RowActionsProps) {
  return <div className={clsx("flex items-center gap-3", className)}>{children}</div>;
}
