import clsx from "clsx";

type ErrorTextProps = {
  children: React.ReactNode;
  className?: string;
};

export function ErrorText({ children, className }: ErrorTextProps) {
  return <p className={clsx("text-bad", className)}>{children}</p>;
}
