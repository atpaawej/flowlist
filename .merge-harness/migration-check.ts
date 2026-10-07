/**
 * Runs migrations/0002 against the real schema with duplicates present.
 *
 * The migration collapses duplicate accounts, and if its SQL is wrong the
 * damage lands on production rows that cannot be un-deleted. So it runs here
 * first — with a duplicate-heavy fixture — rather than being discovered by
 * `wrangler d1 migrations apply`.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(import.meta.dir, "schema.sql"), "utf8");
const migration = readFileSync(
  join(import.meta.dir, "..", "migrations", "0002_agent_accounts.sql"),
  "utf8"
);

let pass = 0;
let fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        got      ${JSON.stringify(actual)}`);
  }
};

function fresh() {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run(schema);
  return db;
}

const apply = (db: Database) => {
  db.transaction(() => db.run(migration))();
};

console.log("\nmigration 0002 on a clean table (the expected production state):");
{
  const db = fresh();
  db.run("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.com', '2026-01-01')");
  db.run("INSERT INTO todos (id, user_id, title) VALUES ('t1', 'u1', 'kept')");
  apply(db);
  check("user survives", db.query("SELECT id FROM users").all(), [{ id: "u1" }]);
  check(
    "todo untouched",
    db.query("SELECT id, user_id FROM todos").all(),
    [{ id: "t1", user_id: "u1" }]
  );
  db.close();
}

console.log("\nmigration 0002 with duplicates (the case it must never see in prod):");
{
  const db = fresh();
  // Two accounts for one email, oldest first.
  db.run("INSERT INTO users (id, email, created_at) VALUES ('old', 'dup@x.com', '2026-01-01')");
  db.run("INSERT INTO users (id, email, created_at) VALUES ('new', 'dup@x.com', '2026-02-01')");
  // Clashing tag name on both sides.
  db.run("INSERT INTO tags (id, user_id, name) VALUES ('g_old', 'old', 'work')");
  db.run("INSERT INTO tags (id, user_id, name) VALUES ('g_new', 'new', 'work')");
  // A distinct tag that should move.
  db.run("INSERT INTO tags (id, user_id, name) VALUES ('g_extra', 'new', 'urgent')");
  db.run("INSERT INTO todos (id, user_id, title) VALUES ('t_new', 'new', 'from newer row')");
  db.run("INSERT INTO todos (id, user_id, title) VALUES ('t_old', 'old', 'from older row')");
  db.run("INSERT INTO todo_tags (todo_id, tag_id) VALUES ('t_new', 'g_new')");
  db.run("INSERT INTO todo_tags (todo_id, tag_id) VALUES ('t_old', 'g_old')");
  db.run("INSERT INTO todo_tags (todo_id, tag_id) VALUES ('t_new', 'g_extra')");

  apply(db);

  check(
    "collapses to one user, the oldest",
    db.query("SELECT id FROM users").all(),
    [{ id: "old" }]
  );
  check(
    "both todos survive under the keeper",
    db.query("SELECT title, user_id FROM todos ORDER BY title").all(),
    [
      { title: "from newer row", user_id: "old" },
      { title: "from older row", user_id: "old" },
    ]
  );
  check(
    "clashing tag deduped to the keeper's",
    db.query("SELECT id, name FROM tags ORDER BY name").all(),
    [
      { id: "g_extra", name: "urgent" },
      { id: "g_old", name: "work" },
    ]
  );
  check(
    "links intact and de-duplicated",
    db
      .query(
        "SELECT todo_id, tag_id FROM todo_tags ORDER BY todo_id, tag_id"
      )
      .all(),
    [
      { todo_id: "t_new", tag_id: "g_extra" },
      { todo_id: "t_new", tag_id: "g_old" },
      { todo_id: "t_old", tag_id: "g_old" },
    ]
  );
  check(
    "no dangling links",
    db
      .query(
        `SELECT COUNT(*) c FROM todo_tags tt
          LEFT JOIN tags t ON t.id = tt.tag_id WHERE t.id IS NULL`
      )
      .all(),
    [{ c: 0 }]
  );
  db.close();
}

console.log("\nre-running the migration is a no-op:");
{
  const db = fresh();
  db.run("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.com', '2026-01-01')");
  db.run("INSERT INTO users (id, email, created_at) VALUES ('u2', 'b@b.com', '2026-01-01')");
  db.run("INSERT INTO tags (id, user_id, name) VALUES ('g1', 'u1', 'work')");
  apply(db);
  let err = "";
  try {
    apply(db);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check("second apply succeeds (IF NOT EXISTS on the index)", err, "");
  check("both distinct users kept", db.query("SELECT COUNT(*) c FROM users").all(), [
    { c: 2 },
  ]);
  db.close();
}

console.log("\nthe unique index actually rejects a second row per email:");
{
  const db = fresh();
  db.run("INSERT INTO users (id, email) VALUES ('u1', 'a@b.com')");
  apply(db);
  let msg = "";
  try {
    db.run("INSERT INTO users (id, email) VALUES ('u2', 'a@b.com')");
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  check("duplicate rejected by constraint", msg.includes("UNIQUE"), true);
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);