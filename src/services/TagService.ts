import { Context, Effect, Layer } from "effect";
import { Database, type DatabaseError } from "./Database";
import type { TodoWithTags } from "@/domain/todo";

export interface TagServiceApi {
  readonly list: (
    userId: string
  ) => Effect.Effect<Array<{ id: string; userId: string; name: string; createdAt: string }>, DatabaseError>;
  readonly create: (
    userId: string,
    name: string
  ) => Effect.Effect<{ id: string; userId: string; name: string; createdAt: string }, DatabaseError>;
  readonly remove: (userId: string, id: string) => Effect.Effect<void, DatabaseError>;
}

export const TagService = Context.Service<TagServiceApi>("TagService");

interface TagRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

const toTag = (row: TagRow) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  createdAt: row.created_at,
});

export const TagServiceLayer = Layer.effect(
    TagService,
    Effect.gen(function* () {
      const db = yield* Database;

      return {
        list: (userId) =>
          Effect.gen(function* () {
            const rows = yield* db.all<TagRow>(
              "SELECT * FROM tags WHERE user_id = ? ORDER BY name ASC",
              [userId]
            );
            return rows.map(toTag);
          }),

        create: (userId, name) =>
          Effect.gen(function* () {
            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            yield* db.execute(
              "INSERT INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
              [id, userId, name, now]
            );
            return { id, userId, name, createdAt: now };
          }),

        remove: (userId, id) =>
          Effect.gen(function* () {
            yield* db.execute(
              "DELETE FROM tags WHERE user_id = ? AND id = ?",
              [userId, id]
            );
          }),
      };
    })
  );
