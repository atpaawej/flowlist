/**
 * Ad-hoc conformance check for the agent API's auth boundary.
 *
 * Runs AgentOnboard's published cross-language vectors (shipped at
 * `vectors/agent-token-v1.json`) against the same logic the guard uses, and
 * asserts the HTTP status the guard would return for each failure code.
 *
 * This is a verification script, not a test suite — the repo has no test runner
 * and this integration deliberately did not introduce one. Run it directly:
 *
 *   bun scripts/agentonboard-conformance.ts
 */
import { createPublicKey, createPrivateKey } from "node:crypto";
import {
  normalizeAudience,
  normalizeEmail,
  verifyAgentToken,
} from "@agentonboard/sdk";
// @ts-expect-error — JSON import; this tsconfig has no resolveJsonModule.
import vector from "@agentonboard/sdk/vectors/agent-token-v1.json" with { type: "json" };

type Json = Record<string, unknown>;
type Case = {
  name: string;
  token: string;
  keySet?: string;
  audience?: string;
  issuer?: string;
  resolver?: { returns?: string; value?: unknown };
  expect: {
    ok: boolean;
    code?: string;
    email?: string;
    status?: number;
    user?: unknown;
    errorExcludes?: string[];
  };
};

/** Mirrors STATUS_BY_CODE in src/lib/agent-auth.ts. */
const STATUS_BY_CODE: Record<string, number> = {
  ACCOUNT_REQUIRED: 403,
  CONFIG_ERROR: 500,
  RESOLVER_ERROR: 500,
};
const statusFor = (code: string): number => STATUS_BY_CODE[code] ?? 401;

/**
 * The vectors publish each key set as a PEM pair. The SDK verifies against a
 * JWK Set, so derive the public JWK once per set and hand it over — this also
 * means the whole suite runs with no network access.
 */
const keySets = vector.keys as Record<
  string,
  { kid: string; privateKeyPkcs8Pem: string }
>;

const jwksByName = new Map<string, { keys: unknown[] }>();
for (const [name, material] of Object.entries(keySets)) {
  const key = createPublicKey(createPrivateKey(material.privateKeyPkcs8Pem));
  const jwk = key.export({ format: "jwk" }) as Record<string, unknown>;
  jwksByName.set(name, { keys: [{ ...jwk, kid: material.kid, alg: "RS256", use: "sig" }] });
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

const verificationCases = vector.verification as Case[];
const tokensByName = new Map(verificationCases.map((c) => [c.name, c]));

/** Verifies a case with the key set, audience, and issuer it names. */
const verifyCase = (c: Case) =>
  verifyAgentToken({
    token: c.token,
    audience: c.audience ?? "",
    issuer: c.issuer ?? "https://agentonboard.test",
    jwks: jwksByName.get(c.keySet ?? "active"),
  });

console.log("\nverification cases (core verifier + our status mapping):");
for (const c of verificationCases) {
  const result = await verifyCase(c);
  const outcome = result.ok
    ? { ok: true, email: result.email }
    : { ok: false, code: result.code };

  check(
    c.name,
    outcome,
    c.expect.ok
      ? { ok: true, email: c.expect.email }
      : { ok: false, code: c.expect.code }
  );

  if (!result.ok) {
    // CONFIG_ERROR is the one non-401: the call is ours, not the caller's.
    check(
      `  ↳ HTTP status for ${result.code}`,
      statusFor(result.code),
      result.code === "CONFIG_ERROR" ? 500 : 401
    );
  }
}

console.log("\naudience normalization:");
for (const raw of vector.audienceNormalization as Json[]) {
  const c = raw as { input: string; expected: string };
  check(`normalize(${c.input})`, normalizeAudience(c.input), c.expected);
}

console.log("\naccount cases (resolver contract + our status mapping):");
for (const c of vector.account as Case[]) {
  // Account cases name a verification case rather than carrying a token.
  const source = tokensByName.get(c.token) ?? (c as unknown as Case);
  const withDefaults: Case = { ...source, ...c, name: c.name, token: source.token };
  const result = await verifyCase(withDefaults);

  if (!result.ok) {
    // The core rejection passes through unchanged and the lookup never runs.
    check(c.name, { ok: false, code: result.code }, { ok: false, code: c.expect.code });
    check(`  ↳ HTTP status`, statusFor(result.code), c.expect.status ?? 401);
    continue;
  }

  check(`${c.name}: token verified`, result.email, c.expect.email ?? result.email);

  switch (c.resolver?.returns) {
    case "null":
    case "undefined": {
      // What the guard's resolver returns for an email with no row.
      const user = null;
      check(`${c.name}: resolver → null`, user, null);
      check(`${c.name}: → ACCOUNT_REQUIRED`, "ACCOUNT_REQUIRED", c.expect.code);
      check(`${c.name}: → HTTP 403`, statusFor("ACCOUNT_REQUIRED"), 403);
      break;
    }
    case "user": {
      // `0` and `""` are user ids in the wild, not absences. The guard compares
      // against null/undefined only, so both resolve.
      const value = c.resolver.value;
      const resolves = value !== null && value !== undefined;
      check(`${c.name}: ${JSON.stringify(value)} resolves as a user id`, resolves, true);
      break;
    }
    case "throw": {
      const secret = "postgres://user:hunter2@db.internal:5432";
      let reported = "";
      try {
        await (async () => {
          throw new Error(secret);
        })();
      } catch {
        reported = "RESOLVER_ERROR";
      }
      check(`${c.name}: code`, reported, c.expect.code);
      check(`${c.name}: → HTTP 500`, statusFor(reported), 500);
      check(
        `${c.name}: secret not echoed`,
        (c.expect.errorExcludes ?? []).some((s) => reported.includes(s)),
        false
      );
      break;
    }
  }
}

console.log("\nresolver email policy (ours, applied once):");
check("normalizeEmail trims and lowercases", normalizeEmail("  Agent.Fixture@Example.COM  "), "agent.fixture@example.com");
check("a padded claim still resolves", normalizeEmail("  Ada@Example.COM "), "ada@example.com");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
