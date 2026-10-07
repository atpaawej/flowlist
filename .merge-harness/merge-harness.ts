/**
 * Exercises the account-merge SQL against the real schema.
 *
 * The merge is the one piece of this change with no upstream test and no
 * documented reference implementation, and it rewrites a user's todos and tags.
 * So: run it here first, on every case that can plausibly break it, before it
 * ever touches production data.
 *
 * The SQL under test lives in MERGE below and is copied verbatim into
 * UserService — if you change one, change both and re-run this.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DbStatement } from "../src/services/Database";

const schema = readFileSync(join(import.meta.dir, "schema.sql"), "utf8");

/**
 * Re-points every child of `donorId` onto `survivorId`, then drops the donor.
 *
 * Ordered so that nothing is ever deleted while a link still points at it:
 * tags are deduped first (the only step that can collide), then todos move, and
 * the donor row goes last. Every clause is declarative — no pre-SELECT — so
 * there is no window between reading the clashes and acting on them.
 */
const MERGE = (survivorId: string, donorId: string): DbStatement[] => {
  const s = survivorId;
  const d = donorId;
  return [
    // A tag name the survivor already has cannot move (UNIQUE(user_id, name)), so
    // the links move to the survivor's tag and the donor's tag is dropped.
    {
      sql: `INSERT OR IGNORE INTO todo_tags (todo_id, tag_id)
   SELECT tt.todo_id, k.id
     FROM todo_tags tt
     JOIN tags dup ON dup.id = tt.tag_id
     JOIN tags k ON k.user_id = ? AND k.name = dup.name
    WHERE dup.user_id = ?`,
      params: [s, d],
    },
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
    // Whatever tags did not clash now belong to the survivor.
    { sql: `UPDATE tags SET user_id = ? WHERE user_id = ?`, params: [s, d] },
    { sql: `UPDATE todos SET user_id = ? WHERE user_id = ?`, params: [s, d] },
    { sql: `DELETE FROM users WHERE id = ?`, params: [d] },
  ];
};

type Fixture = {
  users: Array<[string, string]>;
  todos: Array<[string, string, string]>;
  tags: Array<[string, string, string]>;
  links: Array<[string, string]>;
};

function seed(db: Database, f: Fixture) {
  for (const [id, email] of f.users)
    db.run("INSERT INTO users (id, email) VALUES (?, ?)", [id, email]);
  for (const [id, userId, title] of f.todos)
    db.run("INSERT INTO todos (id, user_id, title) VALUES (?, ?, ?)", [
      id,
      userId,
      title,
    ]);
  for (const [id, userId, name] of f.tags)
    db.run("INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)", [
      id,
      userId,
      name,
    ]);
  for (const [todoId, tagId] of f.links)
    db.run("INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)", [
      todoId,
      tagId,
    ]);
}

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

console.log("\nthe SQL under test is the SQL that ships:");
{
  // Two copies of the merge exist: one here, one in UserService.ts. They must
  // not drift — this file is the only thing that proves the shipped SQL works.
  const service = readFileSync(
    join(import.meta.dir, "..", "src", "services", "UserService.ts"),
    "utf8"
  );
  const shipped = MERGE("__S__", "__D__").map(({ sql }) =>
    sql.replaceAll("?", "__P__").replaceAll(/\s+/g, " ").trim()
  );
  const inService = service
    .slice(service.indexOf("const statements: DbStatement[] = ["))
    .replaceAll("?", "__P__")
    .replaceAll(/\s+/g, " ");
  const drift = shipped
    .map((sql, i) => [sql, i, inService.includes(sql)] as const)
    .filter(([, , ok]) => !ok);
  for (const [, i] of drift) console.log(`        missing statement ${i + 1}`);
  check(
    "every merge statement appears verbatim in UserService",
    drift.length,
    0
  );
}

console.log("\naccount merge (donor rows fold into the Clerk id):");

function runMerge(survivorId: string, donorId: string) {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run(schema);
  const fixture = FIXTURES[`${survivorId}->${donorId}`];
  if (!fixture) throw new Error("no fixture");
  seed(db, fixture);

  // All-or-nothing, mirroring D1 batch(): wrap in a transaction and roll back
  // on any failure, which is what the real driver gives us.
  const apply = (statements: readonly DbStatement[]) => {
    db.run("BEGIN");
    try {
      for (const { sql, params } of statements)
        db.query(sql).all(...(params ?? []));
      db.run("COMMIT");
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
  };

  apply(MERGE(survivorId, donorId));

  const users = db.query("SELECT id FROM users ORDER BY id").all();
  const todos = db
    .query("SELECT id, user_id FROM todos ORDER BY id")
    .all();
  const tags = db.query("SELECT id, user_id, name FROM tags ORDER BY name").all();
  const links = db
    .query("SELECT todo_id, tag_id FROM todo_tags ORDER BY todo_id, tag_id")
    .all();
  db.close();
  return { users, todos, tags, links };
}

const FIXTURES: Record<string, Fixture> = {
  // Agent row is the donor; the human (Clerk) row survives.
  "clerk_1->agent_1": {
    users: [
      ["clerk_1", "ada@example.com"],
      ["agent_1", "ada@example.com"],
    ],
    todos: [["t1", "agent_1", "agent todo"]],
    tags: [["g1", "agent_1", "work"]],
    links: [["t1", "g1"]],
  },
  // Both sides made a tag with the same name — the UNIQUE(user_id, name) trap.
  "clerk_2->agent_2": {
    users: [
      ["clerk_2", "grace@example.com"],
      ["agent_2", "grace@example.com"],
    ],
    todos: [
      ["t1", "agent_2", "agent todo"],
      ["t2", "clerk_2", "human todo"],
    ],
    tags: [
      ["g_agent", "agent_2", "work"],
      ["g_human", "clerk_2", "work"],
    ],
    links: [
      ["t1", "g_agent"],
      ["t2", "g_human"],
    ],
  },
  // Same tag name on both sides AND both tagged the same todo: the
  // (todo_id, tag_id) primary key can already be satisfied.
  "clerk_3->agent_3": {
    users: [
      ["clerk_3", "alan@example.com"],
      ["agent_3", "alan@example.com"],
    ],
    todos: [["t1", "agent_3", "shared todo"]],
    tags: [
      ["g_agent", "agent_3", "work"],
      ["g_human", "clerk_3", "work"],
    ],
    links: [
      ["t1", "g_agent"],
      ["t1", "g_human"],
    ],
  },
  // Distinct tag names on both sides: both tags survive, one user.
  "clerk_4->agent_4": {
    users: [
      ["clerk_4", "edsger@example.com"],
      ["agent_4", "edsger@example.com"],
    ],
    todos: [
      ["t1", "agent_4", "agent todo"],
      ["t2", "clerk_4", "human todo"],
    ],
    tags: [
      ["g_agent", "agent_4", "urgent"],
      ["g_human", "clerk_4", "later"],
    ],
    links: [
      ["t1", "g_agent"],
      ["t2", "g_human"],
    ],
  },
  // Donor has many todos; survivor has none.
  "clerk_5->agent_5": {
    users: [
      ["clerk_5", "edsger2@example.com"],
      ["agent_5", "edsger2@example.com"],
    ],
    todos: [
      ["t1", "agent_5", "one"],
      ["t2", "agent_5", "two"],
      ["t3", "agent_5", "three"],
    ],
    tags: [],
    links: [],
  },
};

console.log("\naccount merge (donor rows fold into the Clerk id):");

const r1 = runMerge("clerk_1", "agent_1");
check("simple: one user left", r1.users, [{ id: "clerk_1" }]);
check("simple: todo re-pointed", r1.todos, [{ id: "t1", user_id: "clerk_1" }]);
check("simple: tag re-pointed", r1.tags, [
  { id: "g1", user_id: "clerk_1", name: "work" },
]);
check("simple: link intact", r1.links, [{ todo_id: "t1", tag_id: "g1" }]);

const r2 = runMerge("clerk_2", "agent_2");
check("clash: one user left", r2.users, [{ id: "clerk_2" }]);
check("clash: both todos survive", r2.todos, [
  { id: "t1", user_id: "clerk_2" },
  { id: "t2", user_id: "clerk_2" },
]);
check("clash: one tag, the survivor's", r2.tags, [
  { id: "g_human", user_id: "clerk_2", name: "work" },
]);
check("clash: agent's link re-pointed to survivor tag", r2.links, [
  { todo_id: "t1", tag_id: "g_human" },
  { todo_id: "t2", tag_id: "g_human" },
]);

const r3 = runMerge("clerk_3", "agent_3");
check("double-tagged: no PK violation", r3.users, [{ id: "clerk_3" }]);
check("double-tagged: one link to one tag", r3.links, [
  { todo_id: "t1", tag_id: "g_human" },
]);

const r4 = runMerge("clerk_4", "agent_4");
check("distinct: both tags kept", r4.tags, [
  { id: "g_human", user_id: "clerk_4", name: "later" },
  { id: "g_agent", user_id: "clerk_4", name: "urgent" },
]);

const r5 = runMerge("clerk_5", "agent_5");
check("bulk: all todos moved", r5.todos, [
  { id: "t1", user_id: "clerk_5" },
  { id: "t2", user_id: "clerk_5" },
  { id: "t3", user_id: "clerk_5" },
]);

console.log("\nidempotency (re-running the merge on a merged db is a no-op):");
{
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run(schema);
  seed(db, FIXTURES["clerk_2->agent_2"]);
  const apply = () => {
    db.run("BEGIN");
    try {
      for (const { sql, params } of MERGE("clerk_2", "agent_2"))
        db.query(sql).all(...(params ?? []));
      db.run("COMMIT");
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
  };
  apply();
  let second = "threw";
  try {
    apply();
    second = "ok";
  } catch (e) {
    second = e instanceof Error ? e.message : String(e);
  }
  check("second merge does not throw", second, "ok");
  check(
    "still one user",
    db.query("SELECT id FROM users").all(),
    [{ id: "clerk_2" }]
  );
  check(
    "todos unchanged",
    db.query("SELECT COUNT(*) c FROM todos").all(),
    [{ c: 2 }]
  );
  db.close();
}

console.log("\nemail normalization (the join key between Clerk and AgentOnboard):");
{
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run(schema);
  // What the signup route writes: normalizeEmail trims and lowercases.
  db.run("INSERT INTO users (id, email, created_at) VALUES ('agent_n', 'ada@example.com', '2026-01-01')");
  db.run("INSERT INTO todos (id, user_id, title) VALUES ('t1', 'agent_n', 'agent work')");

  // What Clerk hands us for the same person, un-normalized.
  const clerkEmail = "  Ada@Example.COM  ";
  const stored = db
    .query("SELECT id FROM users WHERE email = ? LIMIT 1")
    .get(clerkEmail.trim().toLowerCase());
  check("agent row is found by Clerk's email once normalized", stored?.id, "agent_n");

  // ...and if it were NOT normalized, the merge would silently create a second
  // account instead — the exact split brain this feature exists to prevent.
  const unnormalized = db
    .query("SELECT id FROM users WHERE email = ? LIMIT 1")
    .get(clerkEmail);
  check("…but not without normalizing", unnormalized, null);
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);