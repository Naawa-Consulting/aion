"use client";

import clsx from "clsx";
import React from "react";
import { ChevronDown } from "lucide-react";

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string;
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => (
    <div className={clsx("relative", wrapperClassName)}>
      <select
        ref={ref}
        className={clsx(
          "w-full appearance-none rounded-full border border-[var(--color-border)] bg-transparent px-4 py-2 pr-9 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
    </div>
  )
);

Select.displayName = "Select";
