import { Context, Effect, Layer } from "effect";
import { Database, type DatabaseError } from "./Database";
import type {
  Priority,
  SortOption,
  Todo,
  TodoWithTags,
} from "@/domain/todo";

export class TodoNotFoundError {
  constructor(readonly id: string) {}
}

export interface TodoListFilter {
  status?: "active" | "completed" | "all";
  priority?: Priority;
  tag?: string;
  sortBy?: SortOption;
}

export interface CreateTodoInput {
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: Priority;
  tagNames?: readonly string[];
}

export interface UpdateTodoInput {
  title?: string;
  description?: string;
  dueDate?: string | null;
  priority?: Priority;
  completed?: boolean;
  sortOrder?: number;
  tagNames?: readonly string[];
}

export interface TodoServiceApi {
  readonly list: (
    userId: string,
    filter?: TodoListFilter
  ) => Effect.Effect<TodoWithTags[], DatabaseError>;

  readonly get: (
    userId: string,
    id: string
  ) => Effect.Effect<TodoWithTags | null, DatabaseError>;

  readonly create: (
    userId: string,
    input: CreateTodoInput
  ) => Effect.Effect<TodoWithTags, DatabaseError>;

  readonly update: (
    userId: string,
    id: string,
    input: UpdateTodoInput
  ) => Effect.Effect<TodoWithTags, DatabaseError | TodoNotFoundError>;

  readonly remove: (userId: string, id: string) => Effect.Effect<void, DatabaseError>;

  readonly reorder: (
    userId: string,
    orderedIds: readonly string[]
  ) => Effect.Effect<void, DatabaseError>;
}

export const TodoService = Context.Service<TodoServiceApi>("TodoService");

interface TodoRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  due_date: string | null;
  priority: string;
  completed: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const toTodo = (row: TodoRow): Todo => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  description: row.description,
  dueDate: row.due_date,
  priority: row.priority as Priority,
  completed: Boolean(row.completed),
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const TodoServiceLayer = Layer.effect(
  TodoService,
  Effect.gen(function* () {
    const db = yield* Database;

    const attachTags = (
      rows: TodoRow[]
    ): Effect.Effect<TodoWithTags[], DatabaseError> =>
      Effect.gen(function* () {
        if (rows.length === 0) return [];

        const placeholders = rows.map(() => "?").join(", ");
        const tagRows = yield* db.all<{ todo_id: string; name: string }>(
          `SELECT tt.todo_id, t.name
           FROM todo_tags tt
           JOIN tags t ON t.id = tt.tag_id
           WHERE tt.todo_id IN (${placeholders})`,
          rows.map((r) => r.id)
        );

        const byTodo = new Map<string, string[]>();
        for (const row of tagRows) {
          const list = byTodo.get(row.todo_id) ?? [];
          list.push(row.name);
          byTodo.set(row.todo_id, list);
        }

        return rows.map((row) => ({
          ...toTodo(row),
          tags: byTodo.get(row.id) ?? [],
        }));
      });

    const attachTagNames = (
      todoId: string,
      userId: string,
      tagNames: readonly string[]
    ): Effect.Effect<void, DatabaseError> =>
      Effect.gen(function* () {
        if (tagNames.length === 0) return;
        const placeholders = tagNames.map(() => "?").join(", ");
        yield* db.execute(
          `INSERT INTO todo_tags (todo_id, tag_id)
           SELECT ?, id FROM tags
           WHERE user_id = ? AND name IN (${placeholders})`,
          [todoId, userId, ...tagNames]
        );
      });

    return {
      list: (userId, filter = {}) =>
        Effect.gen(function* () {
          const conditions: string[] = ["user_id = ?"];
          const params: unknown[] = [userId];

          if (filter.status === "active") {
            conditions.push("completed = 0");
          } else if (filter.status === "completed") {
            conditions.push("completed = 1");
          }

          if (filter.priority) {
            conditions.push("priority = ?");
            params.push(filter.priority);
          }

          if (filter.tag) {
            conditions.push(
              `id IN (
                 SELECT tt.todo_id FROM todo_tags tt
                 JOIN tags t ON t.id = tt.tag_id
                 WHERE t.user_id = ? AND t.name = ?
               )`
            );
            params.push(userId, filter.tag);
          }

          const orderBy =
            filter.sortBy === "priority"
              ? "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC, sort_order ASC"
              : filter.sortBy === "dueDate"
                ? "due_date IS NULL, due_date ASC"
                : filter.sortBy === "createdAt"
                  ? "created_at DESC"
                  : "sort_order ASC";

          const rows = yield* db.all<TodoRow>(
            `SELECT * FROM todos WHERE ${conditions.join(" AND ")} ORDER BY ${orderBy}`,
            params
          );
          return yield* attachTags(rows);
        }),

      get: (userId, id) =>
        Effect.gen(function* () {
          const rows = yield* db.all<TodoRow>(
            "SELECT * FROM todos WHERE user_id = ? AND id = ?",
            [userId, id]
          );
          if (rows.length === 0) return null;
          const [withTags] = yield* attachTags(rows);
          return withTags;
        }),

      create: (userId, input) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          yield* db.execute(
            `INSERT INTO todos
               (id, user_id, title, description, due_date, priority, completed, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            [
              id,
              userId,
              input.title,
              input.description ?? "",
              input.dueDate ?? null,
              input.priority ?? "medium",
              Date.now(),
              now,
              now,
            ]
          );

          if (input.tagNames && input.tagNames.length > 0) {
            yield* attachTagNames(id, userId, input.tagNames);
          }

          const rows = yield* db.all<TodoRow>(
            "SELECT * FROM todos WHERE id = ?",
            [id]
          );
          const [withTags] = yield* attachTags(rows);
          return withTags;
        }),

      update: (userId, id, input) =>
        Effect.gen(function* () {
          const sets: string[] = [];
          const params: unknown[] = [];

          if (input.title !== undefined) {
            sets.push("title = ?");
            params.push(input.title);
          }
          if (input.description !== undefined) {
            sets.push("description = ?");
            params.push(input.description);
          }
          if (input.dueDate !== undefined) {
            sets.push("due_date = ?");
            params.push(input.dueDate);
          }
          if (input.priority !== undefined) {
            sets.push("priority = ?");
            params.push(input.priority);
          }
          if (input.completed !== undefined) {
            sets.push("completed = ?");
            params.push(input.completed ? 1 : 0);
          }
          if (input.sortOrder !== undefined) {
            sets.push("sort_order = ?");
            params.push(input.sortOrder);
          }

          sets.push("updated_at = ?");
          params.push(new Date().toISOString(), userId, id);

          yield* db.execute(
            `UPDATE todos SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`,
            params
          );

          if (input.tagNames !== undefined) {
            yield* db.execute("DELETE FROM todo_tags WHERE todo_id = ?", [id]);
            yield* attachTagNames(id, userId, input.tagNames);
          }

          const rows = yield* db.all<TodoRow>(
            "SELECT * FROM todos WHERE user_id = ? AND id = ?",
            [userId, id]
          );
          if (rows.length === 0) {
            return yield* Effect.fail(new TodoNotFoundError(id));
          }
          const [withTags] = yield* attachTags(rows);
          return withTags;
        }),

      remove: (userId, id) =>
        Effect.gen(function* () {
          yield* db.execute("DELETE FROM todos WHERE user_id = ? AND id = ?", [
            userId,
            id,
          ]);
        }),

      reorder: (userId, orderedIds) =>
        Effect.gen(function* () {
          const now = new Date().toISOString();
          for (let i = 0; i < orderedIds.length; i++) {
            yield* db.execute(
              "UPDATE todos SET sort_order = ?, updated_at = ? WHERE user_id = ? AND id = ?",
              [i, now, userId, orderedIds[i]]
            );
          }
        }),
    };
  })
);
