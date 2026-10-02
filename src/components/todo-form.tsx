"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Button, INSET_BUTTON_CLASS } from "@/components/button";
import { Kbd } from "@/components/kbd";
import type { TodoWithTags, Priority } from "@/domain/todo";

export interface TodoDraft {
  title: string;
  description: string;
  dueDate: string | null;
  priority: Priority;
  tagNames: string[];
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const field =
  "w-full rounded-notch border border-line-strong bg-surface px-3 text-[14px] text-ink transition-colors duration-150 placeholder:text-ink-3 hover:border-line-strong focus:border-ink-3 focus:outline-none";

export function TodoForm({
  todo,
  tags,
  onSubmit,
  onClose,
  onTagsChange,
}: {
  todo: TodoWithTags | null;
  tags: string[];
  onSubmit: (input: TodoDraft) => void;
  onClose: () => void;
  onTagsChange?: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [knownTags, setKnownTags] = useState(tags);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setKnownTags(tags);
  }, [tags]);

  useEffect(() => {
    setTitle(todo?.title ?? "");
    setDescription(todo?.description ?? "");
    setDueDate(todo?.dueDate ?? "");
    setPriority(todo?.priority ?? "medium");
    setSelectedTags(todo?.tags ?? []);
    setNewTag("");
  }, [todo]);

  // Move focus into the dialog so Tab stays inside it and Esc has a target.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      dueDate: dueDate || null,
      priority,
      tagNames: selectedTags,
    });
  };

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );

  const addTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
      const created = (await res.json()) as { name: string };
      setKnownTags((prev) =>
        prev.includes(created.name) ? prev : [...prev, created.name]
      );
      setSelectedTags((prev) =>
        prev.includes(created.name) ? prev : [...prev, created.name]
      );
      setNewTag("");
      await onTagsChange?.();
    } catch {
      // A failed tag creation shouldn't block writing the task itself.
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      onMouseDown={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-void/70 p-4 pt-[12vh] backdrop-blur-[2px] sm:p-6 sm:pt-[14vh]"
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={todo ? "Edit task" : "New task"}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] rounded-notch border border-line-strong bg-surface"
      >
        <form onSubmit={handleSubmit}>
          <div className="border-b border-line px-5 pt-5 pb-4">
            <label htmlFor="task-title" className="sr-only">
              Task
            </label>
            <input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              className="w-full bg-transparent text-[17px] font-medium tracking-display text-ink placeholder:text-ink-3 focus:outline-none"
            />
          </div>

          <div className="space-y-5 px-5 py-5">
            <div>
              <label htmlFor="task-description" className="sr-only">
                Notes
              </label>
              <textarea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a note (optional)"
                rows={2}
                className={`${field} resize-none py-2.5`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="task-due"
                  className="mb-1.5 block text-[12px] text-ink-2"
                >
                  Due date
                </label>
                <input
                  id="task-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={`${field} h-9 [color-scheme:dark]`}
                />
              </div>
              <div>
                <label
                  htmlFor="task-priority"
                  className="mb-1.5 block text-[12px] text-ink-2"
                >
                  Priority
                </label>
                <select
                  id="task-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className={`${field} h-9 cursor-pointer`}
                >
                  {PRIORITIES.map(({ value, label }) => (
                    <option key={value} value={value} className="bg-surface">
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-[12px] text-ink-2">Tags</span>
              {knownTags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {knownTags.map((tag) => {
                    const on = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        aria-pressed={on}
                        className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 ${
                          on
                            ? "border-ink bg-ink text-void"
                            : "border-line text-ink-2 hover:border-line-strong hover:text-ink"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              )}
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addTag();
                  }
                }}
                placeholder="New tag, then Enter"
                aria-label="Add a tag"
                className={`${field} h-8 text-[13px]`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
            <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
              <Kbd>Esc</Kbd>
              <span>to close</span>
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" className={INSET_BUTTON_CLASS} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                {todo ? "Save changes" : "Add task"}
              </Button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}