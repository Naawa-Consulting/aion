import clsx from "clsx";
import React from "react";

type EyebrowProps = React.HTMLAttributes<HTMLSpanElement>;

// Caption for a form field or table header. Always render as a sibling of the
// control it labels, never a wrapper around it — `uppercase` is an inherited
// CSS property, so wrapping a <select>/<input> in it forces the control's own
// rendered value uppercase too.
export function Eyebrow({ className, children, ...props }: EyebrowProps) {
  return (
    <span
      className={clsx("block text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]", className)}
      {...props}
    >
      {children}
    </span>
  );
}
