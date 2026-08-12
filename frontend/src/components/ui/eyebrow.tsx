import clsx from "clsx";
import React from "react";

type EyebrowProps = React.HTMLAttributes<HTMLSpanElement | HTMLLabelElement> & {
  htmlFor?: string;
};

// Caption para un campo de formulario o encabezado de tabla. Siempre se renderiza como hermano
// del control al que etiqueta, nunca como wrapper — `uppercase` es una propiedad CSS heredada, así
// que envolver un <select>/<input> lo forzaría a mostrar su propio valor en mayúsculas también.
//
// Pasar `htmlFor` lo asocia de verdad al control (<label>) en vez de ser un <span> decorativo —
// hoy hay 37 usos de Eyebrow y 0 `htmlFor` en toda la app. Los call sites existentes no cambian
// hasta que su página adopte la asociación en su propio pase (Fase 7.4-7.8).
export function Eyebrow({ className, children, htmlFor, ...props }: EyebrowProps) {
  const classes = clsx("block text-xs font-medium uppercase tracking-wide text-muted", className);
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={classes} {...(props as React.LabelHTMLAttributes<HTMLLabelElement>)}>
        {children}
      </label>
    );
  }
  return (
    <span className={classes} {...(props as React.HTMLAttributes<HTMLSpanElement>)}>
      {children}
    </span>
  );
}
