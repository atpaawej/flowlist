import { Context, Effect, Layer } from "effect";
import { Database, type DatabaseError, type DatabaseService } from "./Database";
import type { DbStatement } from "./Database";

export interface UserServiceApi {
  /**
   * Keeps the D1 `users` table in sync with Clerk: inserts the user on first
   * request and updates the email whenever it changes.
   *
   * Also merges in any account an AI agent created for this email — see
   * `mergeAgentAccount`.
   */
  readonly ensure: (
    userId: string,
    email: string | null
  ) => Effect.Effect<void, DatabaseError>;
}

export const UserService = Context.Service<UserServiceApi>("UserService");

/**
 * Folds an agent-created account into the human's Clerk account.
 *
 * The situation: an agent called `POST /api/agent/signup`, which inserted a
 * `users` row with a generated id — not a Clerk user id — because the human had
 * not signed in yet. Now they have. Without this, `ensure` would insert a
 * *second* row for the same email and the two would sit side by side forever:
 * the agent's traffic keeps resolving to the older row, the human's dashboard
 * shows an empty list, and nothing anywhere reports an error. Split brain, no
 * alarm.
 *
 * So when the email already belongs to a different row, that row's todos and
 * tags move to the Clerk id and the old row is removed.
 *
 * Ordering is forced by the schema. `todos` and `tags` are `ON DELETE CASCADE`
 * on `users(id)`, so deleting the donor first would take the user's data with
 * it; and there is no `ON UPDATE CASCADE`, so renaming the donor's id is
 * rejected by the foreign key outright. Children move, then the parent goes.
 *
 * Tags are the one step that can actually collide, because
 * `tags(user_id, name)` is UNIQUE: if both accounts made a tag called "work",
 * the donor's cannot move — its links are repointed to the survivor's tag
 * instead, and the donor's tag row is dropped. `INSERT OR IGNORE` covers the
 * remaining case where the same to-do carried both.
 *
 * All of it goes through `db.batch`, which D1 treats as a transaction: a
 * failure anywhere rolls the whole thing back rather than leaving an account
 * half-migrated. The SQL is exercised against this schema by
 * `.merge-harness/merge-harness.ts` — keep the two in step.
 *
 * Every statement is declarative, so there is no window between reading the
 * clashing tags and acting on them.
 */
const mergeAgentAccount =
  (db: DatabaseService) =>
  async (survivorId: string, donorId: string): Promise<void> => {
    const s = survivorId;
    const d = donorId;

    const statements: DbStatement[] = [
      // Point the donor's clashing tags' links at the survivor's tag.
      {
        sql: `INSERT OR IGNORE INTO todo_tags (todo_id, tag_id)
              SELECT tt.todo_id, k.id
                FROM todo_tags tt
                JOIN tags dup ON dup.id = tt.tag_id
                JOIN tags k ON k.user_id = ? AND k.name = dup.name
               WHERE dup.user_id = ?`,
        params: [s, d],
      },
      // Unlink the donor's clashing tags before deleting them, or the FK on
      // todo_tags.tag_id would reject the delete.
      {
        sql: `DELETE FROM todo_tags
               WHERE tag_id IN (
                 SELECT dup.id FROM tags dup
                  WHERE dup.user_id = ?
                    AND EXISTS (SELECT 1 FROM tags k
                                 WHERE k.user_id = ? AND k.name = dup.name)
               )`,
        params: [d, s],
      },
      // Now the clashing tag rows themselves.
      {
        sql: `DELETE FROM tags
               WHERE user_id = ?
                 AND id IN (
                   SELECT dup.id FROM tags dup
                    WHERE dup.user_id = ?
                      AND EXISTS (SELECT 1 FROM tags k
                                   WHERE k.user_id = ? AND k.name = dup.name)
                 )`,
        params: [d, d, s],
      },
      // Tags that did not clash simply move.
      { sql: "UPDATE tags SET user_id = ? WHERE user_id = ?", params: [s, d] },
      { sql: "UPDATE todos SET user_id = ? WHERE user_id = ?", params: [s, d] },
      // Only now is the donor safe to remove.
      { sql: "DELETE FROM users WHERE id = ?", params: [d] },
    ];

    await Effect.runPromise(db.batch(statements));
  };

export const UserServiceLayer = Layer.effect(
    UserService,
    Effect.gen(function* () {
      const db = yield* Database;

      /**
       * Merges every account filed under any of `emails` into this user.
       *
       * The merge runs before the caller writes the new email, so the UNIQUE
       * index is free by the time it does.
       */
      const absorbDonors = function* (userId: string, emails: readonly string[]) {
        for (const email of emails) {
          if (!email) continue;
          const donors = yield* db.all<{ id: string }>(
            "SELECT id FROM users WHERE email = ? AND id <> ?",
            [email, userId]
          );
          for (const donor of donors) {
            yield* Effect.promise(() => mergeAgentAccount(db)(userId, donor.id));
          }
        }
      };

      return {
        ensure: (userId, email) =>
          Effect.gen(function* () {
            const now = new Date().toISOString();
            // Stored the same way `resolveAccount` looks it up. Without this a
            // Clerk session reporting "Ada@Example.com" and an agent token
            // reporting "ada@example.com" would be the same human to Clerk and
            // two different people to us — and the merge would never find them.
            const normalized = email?.trim().toLowerCase() ?? "";

            const rows = yield* db.all<{ email: string }>(
              "SELECT email FROM users WHERE id = ?",
              [userId]
            );

            if (rows.length === 0) {
              // First time we have seen this Clerk id. An account an agent
              // created for this email is this user's — fold it in rather than
              // insert a second row beside it.
              yield* absorbDonors(userId, [normalized]);
              yield* db.execute(
                "INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [userId, normalized, now, now]
              );
            } else if (normalized && normalized !== rows[0].email) {
              // The email moved, or the stored one predates normalization. An
              // agent account could be filed under either address — the one
              // this user had when the agent registered them, or the one they
              // have now — so both are checked before the row is rewritten.
              yield* absorbDonors(userId, [normalized, rows[0].email]);
              yield* db.execute(
                "UPDATE users SET email = ?, updated_at = ? WHERE id = ?",
                [normalized, now, userId]
              );
            }
          }),
      };
    })
  );