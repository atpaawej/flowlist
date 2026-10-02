"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, Reorder, motion } from "framer-motion";
import { TodoItem } from "./todo-item";
import { TodoForm, type TodoDraft } from "./todo-form";
import { TagFilter } from "./tag-filter";
import { SortSelect } from "./sort-select";
import { Button } from "./button";
import { Kbd } from "./kbd";
import type { TodoWithTags, SortOption } from "@/domain/todo";

type FilterStatus = "active" | "completed" | "all";

/**
 * `visualDuration` keeps a reorder feeling the same speed regardless of how
 * far the row travels — a fixed duration gets sluggish on long lists.
 */
const LAYOUT_SPRING = {
  type: "spring",
  visualDuration: 0.24,
  bounce: 0.16,
} as const;

const STATUS_TABS: { value: FilterStatus; label: string }[] = [
  { value: "active", label: "Open" },
  { value: "completed", label: "Done" },
  { value: "all", label: "All" },
];

const LEGEND = [
  { keys: ["j", "k"], label: "move" },
  { keys: ["x"], label: "complete" },
  { keys: ["e"], label: "edit" },
  { keys: ["d"], label: "delete" },
  { keys: ["n"], label: "new" },
];

export function TodoList() {
  const [todos, setTodos] = useState<TodoWithTags[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState<FilterStatus>("active");
  const [filterPriority, setFilterPriority] = useState<string>("");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("custom");

  // Selected by id, not by index. Reordering the list re-numbers the indices,
  // which would silently re-point the keyboard shortcuts (x/e/d) at a
  // different task than the one the row is highlighted on.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadTodos = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: filterStatus, sortBy });
      if (filterPriority) params.set("priority", filterPriority);
      if (filterTag) params.set("tag", filterTag);

      const res = await fetch(`/api/todos?${params}`);
      if (!res.ok) throw new Error("request failed");
      setTodos((await res.json()) as TodoWithTags[]);
      setError(null);
    } catch {
      setError("Couldn't load your tasks. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterPriority, filterTag, sortBy]);

  const loadTags = useCallback(async () => {
    try {
      const res = await fetch("/api/tags");
      if (!res.ok) return;
      const data = (await res.json()) as { name: string }[];
      setTags(data.map((t) => t.name));
    } catch {
      // Tags are optional context; failing to load them shouldn't block the list.
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadTodos();
  }, [loadTodos]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  // A new filter means a new list — drop the cursor.
  useEffect(() => {
    setSelectedId(null);
  }, [filterStatus, filterPriority, filterTag, sortBy]);

  const mutate = useCallback(
    async (path: string, init: RequestInit, fallback: string) => {
      try {
        const res = await fetch(path, init);
        if (!res.ok) throw new Error("request failed");
        return true;
      } catch {
        setError(fallback);
        return false;
      }
    },
    []
  );

  const handleCreate = useCallback(
    async (draft: TodoDraft) => {
      const ok = await mutate(
        "/api/todos",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
        "Couldn't add that task. Try again."
      );
      setShowForm(false);
      await loadTodos();
      void loadTags();
      return ok;
    },
    [mutate, loadTodos, loadTags]
  );

  const handleUpdate = useCallback(
    async (id: string, draft: TodoDraft) => {
      const ok = await mutate(
        `/api/todos/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
        "Couldn't save that change. Try again."
      );
      setEditingId(null);
      await loadTodos();
      void loadTags();
      return ok;
    },
    [mutate, loadTodos, loadTags]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await mutate(
        `/api/todos/${id}`,
        { method: "DELETE" },
        "Couldn't delete that task. Try again."
      );
      if (ok) setEditingId((current) => (current === id ? null : current));
      await loadTodos();
      return ok;
    },
    [mutate, loadTodos]
  );

  const handleToggle = useCallback(
    async (id: string, completed: boolean) => {
      await mutate(
        `/api/todos/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: !completed }),
        },
        "Couldn't update that task. Try again."
      );
      await loadTodos();
    },
    [mutate, loadTodos]
  );

  const handleReorder = useCallback(
    async (next: TodoWithTags[]) => {
      setTodos(next);
      const ok = await mutate(
        "/api/todos/reorder",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: next.map((t) => t.id) }),
        },
        "Couldn't save the new order. Reloading."
      );
      if (!ok) await loadTodos();
    },
    [mutate, loadTodos]
  );

  const dialogOpen = showForm || editingId !== null;
  // No selection yet means the first row; if that row disappears (deleted, or
  // filtered out) fall back to the new first row rather than to nothing.
  const selectedIndex = Math.max(
    todos.findIndex((t) => t.id === selectedId),
    0
  );
  const current = todos[selectedIndex] ?? null;
  const editingTodo = todos.find((t) => t.id === editingId) ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (event.key === "Escape") {
        if (dialogOpen) {
          setShowForm(false);
          setEditingId(null);
        }
        if (typing) target.blur();
        return;
      }

      if (typing || dialogOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

      switch (event.key) {
        case "n":
          event.preventDefault();
          setShowForm(true);
          break;
        case "j":
        case "ArrowDown":
          event.preventDefault();
          setSelectedId(todos[Math.min(selectedIndex + 1, todos.length - 1)]?.id ?? null);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          setSelectedId(todos[Math.max(selectedIndex - 1, 0)]?.id ?? null);
          break;
        case "x":
          if (current) {
            event.preventDefault();
            void handleToggle(current.id, current.completed);
          }
          break;
        case "e":
          if (current) {
            event.preventDefault();
            setEditingId(current.id);
          }
          break;
        case "d":
          if (current) {
            event.preventDefault();
            void handleDelete(current.id);
          }
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [todos, selectedIndex, dialogOpen, current, handleToggle, handleDelete]);

  const filtersActive = filterPriority !== "" || filterTag !== null;

  const emptyState = () => {
    if (filtersActive) {
      return {
        title: "Nothing matches those filters",
        body: "Clear them to see your whole list.",
      };
    }
    if (filterStatus === "completed") {
      return {
        title: "Nothing finished yet",
        body: "Completed tasks collect here once you tick them off.",
      };
    }
    return {
      title: "Your list is clear",
      body: "Add the first thing you need to do.",
    };
  };

  return (
    <section aria-label="Tasks">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter by status"
          className="flex items-center gap-1"
        >
          {STATUS_TABS.map((tab) => {
            const on = filterStatus === tab.value;
            return (
              <button
                key={tab.value}
                role="tab"
                aria-selected={on}
                onClick={() => setFilterStatus(tab.value)}
                className={`rounded-notch px-2.5 py-1.5 text-[13px] transition-colors duration-150 ease-[var(--ease-out-expo)] ${
                  on ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <SortSelect value={sortBy} onChange={setSortBy} />
          <Button onClick={() => setShowForm(true)} className="h-8 px-3">
            New task
            <Kbd className="border-void/20 bg-void/10 text-void/80">n</Kbd>
          </Button>
        </div>
      </div>

      {/* Secondary filters */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
        <TagFilter
          tags={tags}
          selected={filterTag}
          onSelect={setFilterTag}
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <span>Priority</span>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="cursor-pointer rounded-[5px] border border-line bg-transparent py-1 pl-2 pr-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink focus:border-ink-3 focus:outline-none [color-scheme:dark]"
            >
              <option value="" className="bg-surface">
                Any
              </option>
              <option value="high" className="bg-surface">
                High
              </option>
              <option value="medium" className="bg-surface">
                Medium
              </option>
              <option value="low" className="bg-surface">
                Low
              </option>
            </select>
          </label>
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setFilterTag(null);
                setFilterPriority("");
              }}
              className="text-[12px] text-ink-3 underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Errors explain the fix, never apologise. */}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-notch border border-danger/30 bg-danger/5 px-3.5 py-3 text-[13px] text-danger"
        >
          {error}
        </div>
      )}

      {/* List */}
      <div className="mt-2 -mx-2">
        {loading ? (
          <ul aria-hidden>
            {[68, 68, 68].map((h, i) => (
              <li
                key={i}
                className="h-[68px] animate-pulse rounded-notch border border-line bg-surface/50"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </ul>
        ) : todos.length === 0 ? (
          <EmptyState
            state={emptyState()}
            onCreate={filtersActive ? undefined : () => setShowForm(true)}
          />
        ) : sortBy === "custom" ? (
          <Reorder.Group
            axis="y"
            values={todos}
            onReorder={handleReorder}
            className="flex flex-col"
          >
            <AnimatePresence initial={false}>
              {todos.map((todo, index) => (
                <Reorder.Item
                  key={todo.id}
                  value={todo}
                  transition={LAYOUT_SPRING}
                >
                  <TodoItem
                    todo={todo}
                    selected={index === selectedIndex}
                    onToggle={handleToggle}
                    onSelect={() => setSelectedId(todo.id)}
                    onEdit={() => setEditingId(todo.id)}
                    onDelete={() => void handleDelete(todo.id)}
                  />
                </Reorder.Item>
              ))}
            </AnimatePresence>
          </Reorder.Group>
        ) : (
          <div className="flex flex-col">
            <AnimatePresence initial={false}>
              {todos.map((todo, index) => (
                <motion.div
                  key={todo.id}
                  layout="position"
                  transition={LAYOUT_SPRING}
                >
                  <TodoItem
                    todo={todo}
                    selected={index === selectedIndex}
                    onToggle={handleToggle}
                    onSelect={() => setSelectedId(todo.id)}
                    onEdit={() => setEditingId(todo.id)}
                    onDelete={() => void handleDelete(todo.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Legend — only worth the space once there's something to drive. */}
      {!loading && todos.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4">
          {LEGEND.map(({ keys, label }) => (
            <span key={label} className="flex items-center gap-1.5">
              {keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
              <span className="text-[12px] text-ink-3">{label}</span>
            </span>
          ))}
        </div>
      )}

      <AnimatePresence>
        {dialogOpen && (
          <TodoForm
            key={editingTodo?.id ?? "new"}
            todo={editingTodo}
            tags={tags}
            onSubmit={(draft) =>
              editingTodo ? handleUpdate(editingTodo.id, draft) : handleCreate(draft)
            }
            onClose={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            onTagsChange={loadTags}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function EmptyState({
  state,
  onCreate,
}: {
  state: { title: string; body: string };
  onCreate?: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 border-t border-line py-16">
      <p className="text-[15px] font-medium text-ink">{state.title}</p>
      <p className="text-[14px] text-ink-2">{state.body}</p>
      {onCreate && (
        <Button onClick={onCreate} className="mt-2">
          Add a task
        </Button>
      )}
    </div>
  );
}