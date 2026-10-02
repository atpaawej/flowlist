import { Context, Effect, Layer } from "effect";
import { Database, type DatabaseError } from "./Database";

export interface UserServiceApi {
  /**
   * Keeps the D1 `users` table in sync with Clerk: inserts the user on first
   * request and updates the email whenever it changes.
   */
  readonly ensure: (
    userId: string,
    email: string | null
  ) => Effect.Effect<void, DatabaseError>;
}

export const UserService = Context.Service<UserServiceApi>("UserService");

export const UserServiceLayer = Layer.effect(
    UserService,
    Effect.gen(function* () {
      const db = yield* Database;

      return {
        ensure: (userId, email) =>
          Effect.gen(function* () {
            const rows = yield* db.all<{ email: string }>(
              "SELECT email FROM users WHERE id = ?",
              [userId]
            );
            const now = new Date().toISOString();

            if (rows.length === 0) {
              yield* db.execute(
                "INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [userId, email ?? "", now, now]
              );
            } else if (email && email !== rows[0].email) {
              yield* db.execute(
                "UPDATE users SET email = ?, updated_at = ? WHERE id = ?",
                [email, now, userId]
              );
            }
          }),
      };
    })
  );
