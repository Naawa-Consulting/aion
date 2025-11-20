import React from "react";

type Props = {
  predictors: string[];
  onRemove: (name: string) => void;
  onClear: () => void;
};

export function SelectedPredictorsQuickView({ predictors, onRemove, onClear }: Props) {
  if (!predictors.length) {
    return (
      <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-border)]/20 px-4 py-3 text-xs text-[var(--color-muted)]">
        No predictors selected yet. Choose variables from the left panel.
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-[var(--color-foreground)]">
          Selected predictors
          <span className="ml-2 rounded-full bg-[var(--color-border)]/50 px-2 py-0.5 text-[11px] font-normal text-[var(--color-muted)]">
            {predictors.length} selected
          </span>
        </p>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          Clear all
        </button>
      </div>
      <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
        {predictors.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onRemove(name)}
            className="group flex items-center gap-1 rounded-full bg-[var(--color-border)]/50 px-2.5 py-1 text-[11px] text-[var(--color-foreground)] hover:bg-[var(--color-border)]"
          >
            <span className="max-w-[160px] truncate" title={name}>
              {name}
            </span>
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] text-[var(--color-muted)] group-hover:bg-[var(--color-bg)]">
              ×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

