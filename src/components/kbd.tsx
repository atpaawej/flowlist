import { cn } from "@/lib/utils";

/**
 * A key cap. Sized to sit on the text baseline so keyboard hints align with
 * the words they label.
 */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong bg-raised px-1 font-sans text-[11px] leading-none font-medium text-ink-2",
        className
      )}
      {...props}
    />
  );
}