type ProgressProps = {
  value: number;
};

export function Progress({ value }: ProgressProps) {
  return (
    <div className="h-2 w-full rounded-full bg-surface-2">
      <div
        className="h-2 rounded-full bg-accent transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

