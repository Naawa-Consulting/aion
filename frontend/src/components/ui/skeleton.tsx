import clsx from "clsx";

type SkeletonProps = {
  className?: string;
  shape?: "line" | "rect" | "circle";
};

export function Skeleton({ className, shape = "rect" }: SkeletonProps) {
  return (
    <div
      className={clsx(
        "animate-pulse bg-surface-2",
        shape === "line" && "h-3 rounded-md",
        shape === "rect" && "rounded-lg",
        shape === "circle" && "rounded-full",
        className
      )}
    />
  );
}
