import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The wordmark is a single glyph followed by the name. No rounded container
 * behind it — the mark is a typographic element, not an app icon.
 */
export function Wordmark({
  className,
  href = "/",
}: {
  className?: string;
  href?: string | null;
}) {
  const content = (
    <span className={cn("inline-flex items-baseline gap-[0.42em]", className)}>
      <span
        aria-hidden
        className="inline-block h-[0.62em] w-[0.62em] translate-y-[-0.06em] bg-ink"
      />
      <span className="font-medium tracking-display">Flowlist</span>
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="text-ink transition-opacity hover:opacity-70">
      {content}
    </Link>
  );
}