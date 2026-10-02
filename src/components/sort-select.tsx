"use client";

import type { SortOption } from "@/domain/todo";

const OPTIONS: { value: SortOption; label: string }[] = [
  { value: "custom", label: "Custom order" },
  { value: "priority", label: "Priority" },
  { value: "dueDate", label: "Due date" },
  { value: "createdAt", label: "Created" },
];

export function SortSelect({
  value,
  onChange,
}: {
  value: SortOption;
  onChange: (value: SortOption) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
      <span>Sort</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
        className="cursor-pointer rounded-[5px] border border-line bg-transparent py-1 pl-2 pr-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink focus:border-ink-3 focus:outline-none [color-scheme:dark]"
      >
        {OPTIONS.map(({ value: v, label }) => (
          <option key={v} value={v} className="bg-surface">
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}