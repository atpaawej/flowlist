/**
 * Renders /auth.md exactly as the route does, and checks the document an agent
 * will actually read.
 *
 * AgentOnboard has no validator for this file: nothing in the SDK, the CLI, or
 * the partner tooling fetches or checks it. The document *is* the contract, so
 * the only way to know it is right is to read it — and to check that what it
 * advertises actually exists.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "..", "src", "app", "auth.md", "route.ts"),
  "utf8"
);

// Pull the template out of the route so this checks the shipped text rather
// than a copy of it.
const start = source.indexOf("const authMd = (audience: string) =>");
if (start === -1) throw new Error("could not find the authMd template");
const body = source.slice(start, source.indexOf("\n`;", start));

const AUDIENCE = "flowlist.agentonboard.xyz";
// Normalize the template the same way the route's escaping does: `\`` in the
// source is a literal backtick in the output, and CRLF would defeat any regex
// that has to cross a line ending.
const rendered = body
  .slice(body.indexOf("=> `") + 4)
  .replaceAll("\\`", "`")
  .replaceAll("\r\n", "\n")
  .replaceAll("${audience}", AUDIENCE);

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

console.log("\nauth.md structure (AgentOnboard requires three sections, in order):");
check("starts with the H1", rendered.startsWith("# Flowlist API"), true);

const sections = ["## Audience", "## Endpoints", "## When a request is rejected"];
const positions = sections.map((s) => rendered.indexOf(s));
check("all three sections present", positions.every((p) => p > -1), true);
check(
  "sections appear in the required order",
  positions.every((p, i) => i === 0 || p > positions[i - 1]),
  true
);
check("no front matter before the H1", rendered.startsWith("# "), true);

console.log("\nthe audience an agent will mint a token for:");
check("audience section carries the hostname", rendered.includes(`\`${AUDIENCE}\``), true);
check("minting command matches", rendered.includes(`aon token get ${AUDIENCE}`), true);
check("header format stated", rendered.includes("Authorization: Bearer <token>"), true);

console.log("\nthe signup door is published and consistent:");
check("signup endpoint documented", rendered.includes("POST /api/agent/signup"), true);

// Match the whole 403 row rather than reaching across cells: the row names the
// signup endpoint in backticks of its own, so a `[^|]*` anchored on the code
// will not find it.
const row403 = rendered
  .split("\n")
  .find((l) => l.startsWith("| 403 |") && l.includes("ACCOUNT_REQUIRED"));
check("a 403 ACCOUNT_REQUIRED row exists", typeof row403, "string");
check("403 row points at the signup endpoint", !!row403?.includes("POST /api/agent/signup"), true);
check("403 row says retry once", !!row403?.includes("**once**"), true);
check(
  "403 row warns that a bare retry never succeeds",
  !!row403?.includes("Retrying without that will never succeed"),
  true
);
check(
  "403 row does not send the agent to a human signup page",
  !row403?.includes("/sign-up"),
  true
);
check(
  "no lingering instruction to send the human to sign up",
  rendered.includes("Ask the human to sign up"),
  false
);
check("201 documented for a fresh account", rendered.includes("201") && rendered.includes("created"), true);

console.log("\nevery endpoint the file advertises is really implemented:");
{
  const advertised = [...rendered.matchAll(/### `(GET|POST|PATCH|DELETE) (\/[^`]*)`/g)].map(
    (m) => `${m[1]} ${m[2]}`
  );
  check("at least the eight agent endpoints plus signup", advertised.length >= 9, true);

  const routeDir = join(import.meta.dir, "..", "src", "app");
  const exists = (method: string, p: string) => {
    const clean = p.replace(/\{id\}/g, "[id]");
    try {
      const file = readFileSync(join(routeDir, clean, "route.ts"), "utf8");
      return file.includes(`export async function ${method}(`);
    } catch {
      return false;
    }
  };
  for (const entry of advertised) {
    const [method, path] = entry.split(" ");
    check(`${entry} implemented`, exists(method, path), true);
  }
}

console.log("\nthe rejection table's codes match what the code can return:");
{
  const guard = readFileSync(
    join(import.meta.dir, "..", "src", "lib", "agent-auth.ts"),
    "utf8"
  );
  const route = readFileSync(
    join(import.meta.dir, "..", "src", "app", "api", "agent", "signup", "route.ts"),
    "utf8"
  );
  // Only the rejection table's `code` column is a claim about failure modes —
  // not every SCREAMING_SNAKE token in the document, which also covers token
  // error codes and HTTP methods.
  const tableRows = rendered
    .split("\n")
    .filter((l) => /^\| \d{3} \|/.test(l));
  const codes = [...new Set(tableRows.flatMap((l) => [...l.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1])))];
  const known = new Set([
    "ACCOUNT_REQUIRED", "CONFIG_ERROR", "RESOLVER_ERROR", "RATE_LIMITED",
    "NOT_FOUND", "INVALID_REQUEST", "INTERNAL_ERROR",
    // Token-side codes, all 401, published by the guard and the SDK.
    "EXPIRED", "INVALID_SIGNATURE", "AUDIENCE_MISMATCH", "ISSUER_MISMATCH",
    "MALFORMED_TOKEN", "UNKNOWN_KEY", "KEY_SOURCE_UNAVAILABLE", "MISSING_EMAIL",
  ]);
  const unknown = codes.filter((c) => !known.has(c));
  check("no invented codes in the table", unknown, []);
  check("table has a row for each status we return", tableRows.length >= 5, true);
  check(
    "ACCOUNT_REQUIRED is 403 in the guard",
    /ACCOUNT_REQUIRED:\s*403/.test(guard),
    true
  );
  check(
    "signup never reports ACCOUNT_REQUIRED",
    route.includes("ACCOUNT_REQUIRED") === false ||
      route.includes("never reports"),
    true
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);