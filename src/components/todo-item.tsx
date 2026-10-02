"use client";

import { motion } from "framer-motion";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { TodoWithTags } from "@/domain/todo";
import { Pencil, Trash2 } from "lucide-react";

/**
 * One task. A row in a list rather than a card — the selection is the only
 * thing that earns a background, so the list reads as one surface.
 *
 * Row actions reveal on hover, on keyboard focus, and on selection, so the
 * keys (e, d) and the pointer always act on the same task.
 */
export function TodoItem({
  todo,
  selected,
  onToggle,
  onSelect,
  onEdit,
  onDelete,
}: {
  todo: TodoWithTags;
  selected: boolean;
  onToggle: (id: string, completed: boolean) => void;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const overdue =
    todo.dueDate !== null &&
    !todo.completed &&
    new Date(todo.dueDate).setHours(23, 59, 59, 999) < Date.now();

  const dueLabel = todo.dueDate
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(new Date(todo.dueDate))
    : null;

  return (
    <motion.div
      onMouseDown={onSelect}
      className={cn(
        "group relative -mx-2 flex cursor-default items-start gap-3 rounded-notch px-2 py-3 transition-colors duration-150 ease-[var(--ease-out-expo)]",
        selected ? "bg-raised" : "hover:bg-surface"
      )}
    >
      {/* Selection reads as a lit left edge, not a filled card. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-ink transition-opacity duration-150",
          selected ? "opacity-100" : "opacity-0"
        )}
      />

      <div className="relative pt-[3px]">
        <Checkbox
          checked={todo.completed}
          onCheckedChange={() => onToggle(todo.id, todo.completed)}
          aria-label={todo.completed ? `Reopen ${todo.title}` : `Complete ${todo.title}`}
        />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[14px] leading-[1.45] transition-colors duration-200",
            todo.completed ? "text-ink-3 line-through" : "text-ink"
          )}
        >
          {todo.title}
        </p>

        {todo.description && (
          <p
            className={cn(
              "mt-1 line-clamp-2 text-[13px] leading-[1.5]",
              todo.completed ? "text-ink-3/70" : "text-ink-2"
            )}
          >
            {todo.description}
          </p>
        )}

        {(todo.tags.length > 0 || dueLabel) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {todo.tags.map((tag) => (
              <span key={tag} className="text-[12px] text-ink-3">
                #{tag}
              </span>
            ))}
            {dueLabel && (
              <span className={cn("text-[12px]", overdue ? "text-danger" : "text-ink-3")}>
                {overdue ? "Overdue" : "Due"} {dueLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Fade rather than slide — actions sit in already-reserved space, so
          revealing them must not push the row's contents sideways. */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 self-center transition-opacity duration-150 ease-[var(--ease-out-expo)]",
          selected
            ? "opacity-100"
            : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
        )}
      >
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${todo.title}`}
          className="grid size-7 place-items-center rounded-[5px] text-ink-3 transition-colors duration-150 hover:bg-line hover:text-ink"
        >
          <Pencil className="size-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${todo.title}`}
          className="grid size-7 place-items-center rounded-[5px] text-ink-3 transition-colors duration-150 hover:bg-line hover:text-danger"
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </motion.div>
  );
}