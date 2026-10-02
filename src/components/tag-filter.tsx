"use client";

import { cn } from "@/lib/utils";

/**
 * Tag filters are the one place pills are right — a round cap reads as a
 * tag regardless of the label, so the shape carries meaning.
 */
export function TagFilter({
  tags,
  selected,
  onSelect,
}: {
  tags: string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => {
        const on = tag === selected;
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(on ? null : tag)}
            className={cn(
              "rounded-full border px-2.5 py-[3px] text-[12px] transition-colors duration-150 ease-[var(--ease-out-expo)]",
              on
                ? "border-ink bg-ink text-void"
                : "border-line text-ink-2 hover:border-line-strong hover:text-ink"
            )}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}