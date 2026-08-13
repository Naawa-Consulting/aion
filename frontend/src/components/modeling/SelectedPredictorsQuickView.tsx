import React from "react";

type Props = {
  predictors: string[];
  onRemove: (name: string) => void;
  onClear: () => void;
  title: string;
  countLabel: (count: number) => string;
  clearLabel: string;
  removeLabel: (name: string) => string;
  emptyLabel: string;
};

export function SelectedPredictorsQuickView({
  predictors,
  onRemove,
  onClear,
  title,
  countLabel,
  clearLabel,
  removeLabel,
  emptyLabel,
}: Props) {
  if (!predictors.length) {
    return (
      <div className="mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-ink">
          {title}
          <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-normal text-muted">
            {countLabel(predictors.length)}
          </span>
        </p>
        <button type="button" onClick={onClear} className="text-2xs text-muted hover:text-ink">
          {clearLabel}
        </button>
      </div>
      <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
        {predictors.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onRemove(name)}
            aria-label={removeLabel(name)}
            className="group flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-2xs text-ink hover:bg-line"
          >
            <span className="max-w-[160px] truncate" title={name}>
              {name}
            </span>
            <span
              aria-hidden
              className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface text-3xs text-muted group-hover:bg-plane"
            >
              ×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
