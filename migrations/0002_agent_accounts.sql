-- Agent-created accounts, and one identity per email.
--
-- Until now `users.id` was always a Clerk user id: a row existed only because a
-- human had signed in, so an email identified at most one account. Agents can
-- now register a human directly (POST /api/agent/signup) with a generated id,
-- and when that human later signs in through Clerk the two rows are merged.
-- That merge needs an email to identify exactly one account, so this migration
-- collapses any duplicates first and then makes that a constraint.
--
-- Children are re-pointed before their parent row is deleted, always:
-- `todos.user_id` and `tags.user_id` are `ON DELETE CASCADE`, so deleting a
-- duplicate `users` row first would take the user's data with it. SQLite has no
-- ON UPDATE CASCADE on these columns, so `UPDATE users SET id` is rejected by
-- the foreign key outright.
--
-- The per-user merge (a human signing in over an agent-created row) lives in
-- `UserService.ensure`, and follows the same ordering. Both were exercised
-- against this exact schema by `.merge-harness/merge-harness.ts`.
--
-- Before running against production, confirm the collapse is a no-op:
--
--   SELECT email, COUNT(*) c FROM users GROUP BY email HAVING c > 1;
--
-- Expect zero rows. Non-zero is not a duplicate-email problem to paper over;
-- inspect those accounts first. `keeper` below is always the oldest row for the
-- email, which is the one `resolveAccount` already resolves to — so an agent
-- mid-request does not see its account change identity under it.

-- 1. Where the keeper already has a tag of the same name, the duplicate's tag
--    cannot move (tags is UNIQUE(user_id, name)). Re-point that tag's links to
--    the keeper's tag and drop the duplicate tag. `INSERT OR IGNORE` because
--    the (todo_id, tag_id) primary key can already be satisfied when both
--    accounts put the same tag on the same to-do.
INSERT OR IGNORE INTO todo_tags (todo_id, tag_id)
SELECT tt.todo_id, keeper_tag.id
  FROM todo_tags tt
  JOIN tags dup_tag ON dup_tag.id = tt.tag_id
  JOIN users dup ON dup.id = dup_tag.user_id
  JOIN users keeper ON keeper.email = dup.email
  JOIN tags keeper_tag ON keeper_tag.user_id = keeper.id
                      AND keeper_tag.name = dup_tag.name
 WHERE keeper.id = (
         SELECT k2.id FROM users k2
          WHERE k2.email = dup.email
          ORDER BY k2.created_at, k2.id LIMIT 1
       )
   AND keeper.id <> dup.id;

DELETE FROM todo_tags
 WHERE tag_id IN (
   SELECT dup_tag.id
     FROM tags dup_tag
     JOIN users dup ON dup.id = dup_tag.user_id
     JOIN users keeper ON keeper.email = dup.email
    WHERE keeper.id = (
            SELECT k2.id FROM users k2
             WHERE k2.email = dup.email
             ORDER BY k2.created_at, k2.id LIMIT 1
          )
      AND keeper.id <> dup.id
      AND EXISTS (
            SELECT 1 FROM tags keeper_tag
             WHERE keeper_tag.user_id = keeper.id
               AND keeper_tag.name = dup_tag.name
          )
 );

DELETE FROM tags
 WHERE id IN (
   SELECT dup_tag.id
     FROM tags dup_tag
     JOIN users dup ON dup.id = dup_tag.user_id
     JOIN users keeper ON keeper.email = dup.email
    WHERE keeper.id = (
            SELECT k2.id FROM users k2
             WHERE k2.email = dup.email
             ORDER BY k2.created_at, k2.id LIMIT 1
          )
      AND keeper.id <> dup.id
      AND EXISTS (
            SELECT 1 FROM tags keeper_tag
             WHERE keeper_tag.user_id = keeper.id
               AND keeper_tag.name = dup_tag.name
          )
 );

-- 2. Tags that did not clash move onto the keeper.
UPDATE tags
   SET user_id = (
         SELECT keeper.id FROM users keeper
          WHERE keeper.email = (SELECT dup.email FROM users dup WHERE dup.id = tags.user_id)
          ORDER BY keeper.created_at, keeper.id LIMIT 1
       )
 WHERE user_id IN (
       SELECT id FROM users WHERE id NOT IN (
         SELECT keeper.id FROM users keeper
          WHERE keeper.created_at = (
                  SELECT MIN(k2.created_at) FROM users k2 WHERE k2.email = users.email
                )
            AND keeper.id = (
                  SELECT k3.id FROM users k3
                   WHERE k3.email = users.email
                   ORDER BY k3.created_at, k3.id LIMIT 1
                )
       )
 );

-- 3. Todos follow their tags.
UPDATE todos
   SET user_id = (
         SELECT keeper.id FROM users keeper
          WHERE keeper.email = (SELECT dup.email FROM users dup WHERE dup.id = todos.user_id)
          ORDER BY keeper.created_at, keeper.id LIMIT 1
       )
 WHERE user_id IN (
       SELECT id FROM users WHERE id NOT IN (
         SELECT keeper.id FROM users keeper
          WHERE keeper.created_at = (
                  SELECT MIN(k2.created_at) FROM users k2 WHERE k2.email = users.email
                )
            AND keeper.id = (
                  SELECT k3.id FROM users k3
                   WHERE k3.email = users.email
                   ORDER BY k3.created_at, k3.id LIMIT 1
                )
       )
 );

-- 4. Only now are the emptied duplicate rows safe to remove.
DELETE FROM users
 WHERE id NOT IN (
       SELECT keeper.id FROM users keeper
        WHERE keeper.created_at = (
                SELECT MIN(k2.created_at) FROM users k2 WHERE k2.email = users.email
              )
          AND keeper.id = (
                SELECT k3.id FROM users k3
                 WHERE k3.email = users.email
                 ORDER BY k3.created_at, k3.id LIMIT 1
              )
 );

-- 5. The constraint itself. With email unique, the runtime merge is always
--    exactly one donor into one survivor, and agent signup can use
--    ON CONFLICT(email) DO NOTHING instead of a read-then-write race.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(email);