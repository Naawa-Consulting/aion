type Props = {
  predictors: string[];
  onRemove: (name: string) => void;
  onClear: () => void;
};

export function SelectedPredictorsQuickView({ predictors, onRemove, onClear }: Props) {
  if (!predictors.length) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-border)]/10 px-4 py-3 text-xs text-[var(--color-muted)]">
        No predictors selected yet. Choose variables from the left panel.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-background px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-[var(--color-foreground)]">
          Selected predictors
          <span className="ml-2 rounded-full bg-[var(--color-border)]/40 px-2 py-0.5 text-[11px] font-normal text-[var(--color-muted)]">
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
      <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
        {predictors.map((name) => (
          <button
            type="button"
            key={name}
            onClick={() => onRemove(name)}
            className="group flex items-center gap-1 rounded-full bg-[var(--color-border)]/30 px-2.5 py-1 text-[11px] text-[var(--color-foreground)] hover:bg-[var(--color-border)]/60"
          >
            <span className="max-w-[140px] truncate" title={name}>
              {name}
            </span>
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-border)]/80 text-[10px] text-[var(--color-muted)] group-hover:bg-[var(--color-border)]">
              ×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
