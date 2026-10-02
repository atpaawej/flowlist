import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex h-9 items-center justify-center gap-2 rounded-notch px-4 text-[13px] font-medium transition-[background-color,border-color,color,opacity] duration-150 ease-[var(--ease-out-expo)] disabled:pointer-events-none disabled:opacity-40";

const variants: Record<Variant, string> = {
  // One filled button per view. Everything else is a hairline.
  primary: "bg-ink text-void hover:bg-ink/85",
  secondary: "border border-line-strong text-ink hover:border-ink-3 hover:bg-raised",
  ghost: "text-ink-2 hover:bg-raised hover:text-ink",
};

/**
 * The secondary button sits on `--color-surface`, so its resting border is one
 * step lighter than `secondary` would use on the page background.
 */
export const INSET_BUTTON_CLASS =
  "border-line bg-transparent text-ink hover:border-ink-3 hover:bg-raised";

export function buttonClass(variant: Variant = "primary") {
  return cn(base, variants[variant]);
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cn(buttonClass(variant), className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(buttonClass(variant), className)} {...props} />;
}