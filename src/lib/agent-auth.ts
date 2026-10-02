import { NextResponse } from "next/server";
import { Cause, Effect, Exit } from "effect";
import {
  normalizeEmail,
  verifyAgentToken,
  type VerifyErrorCode,
} from "@agentonboard/sdk";
import { getDatabase } from "@/lib/d1";
import { makeAppLayer, type AppServices } from "@/layers/AppLayer";
import { DatabaseError, type DatabaseService } from "@/services/Database";
import { TodoNotFoundError } from "@/services/TodoService";

/**
 * The agent API: the same todo and tag operations the dashboard uses, reachable
 * by an AI agent acting for a signed-in human.
 *
 * This is a *second* boundary, deliberately kept separate from `withAuth` in
 * `lib/api.ts`. The human API is guarded by a Clerk session; this one by an
 * AgentOnboard token. Keeping them apart means agent policy — rate limits, audit
 * logging, the error contract — has one home, and a route that must be
 * human-only is human-only by simply not using this helper.
 *
 * Identity is the email claim mapped to a Clerk user id; see `resolveAccount`
 * for why that is defensible *here* and what it forbids.
 */

/**
 * Requests per minute, per user. Generous enough that bulk work like "triage my
 * inbox" (~40-60 calls) never trips it, tight enough to bound a runaway loop.
 */
const RATE_LIMIT_PER_MINUTE = 120;

/**
 * The status each failure answers with, and why.
 *
 * Every token-side code is a flat 401 on purpose. Splitting them across 400,
 * 419, and 503 would hand anyone probing this endpoint a map of which part of a
 * forgery attempt failed. `ACCOUNT_REQUIRED` is 403 because the token verified
 * and only the account is missing — a 401 there invites a re-authentication
 * loop against a token that is fine. `CONFIG_ERROR` and `RESOLVER_ERROR` are
 * 500 because nobody's request is wrong.
 */
const STATUS_BY_CODE: Record<string, number> = {
  ACCOUNT_REQUIRED: 403,
  CONFIG_ERROR: 500,
  RESOLVER_ERROR: 500,
};

const TOKEN_CODES: readonly VerifyErrorCode[] = [
  "EXPIRED",
  "INVALID_SIGNATURE",
  "AUDIENCE_MISMATCH",
  "ISSUER_MISMATCH",
  "MALFORMED_TOKEN",
  "UNKNOWN_KEY",
  "KEY_SOURCE_UNAVAILABLE",
  "MISSING_EMAIL",
];

const statusFor = (code: string): number => STATUS_BY_CODE[code] ?? 401;

/** `{ code, error }` — the shape an agent branches on. `code` is the contract. */
const fail = (code: string, error: string, status: number, headers?: HeadersInit) =>
  NextResponse.json({ code, error }, { status, headers });

/**
 * The whole identity boundary: a verified AgentOnboard email becomes a Flowlist
 * user id, or nothing at all.
 *
 * Why matching on email is defensible for this deployment: Flowlist and
 * AgentOnboard are operated by the same principal, and `users.email` is only
 * ever written from a Clerk session (`UserService.ensure`, called on every
 * authenticated request). A row in `users` therefore means the inbox was proven
 * at signup, which is the same assertion the token makes.
 *
 * For a service where the two ends have different operators this function would
 * be an account-takeover path — the AgentOnboard docs are explicit about that,
 * and the rule is that this must move behind an explicit connect flow.
 *
 * Two properties this must keep:
 *
 * - **Never create a row here.** AgentOnboard has no consent model: any of its
 *   users can mint a valid token for this audience whether or not they have ever
 *   heard of Flowlist. An unknown email returns `null` so the caller gets
 *   `ACCOUNT_REQUIRED` -> 403, and the human is sent to sign up.
 * - **`ORDER BY created_at`** because `users.email` carries no UNIQUE
 *   constraint. Picking a row deterministically keeps an agent bound to the
 *   same account across requests instead of flapping between duplicates.
 *
 * Only `null` and `undefined` mean "no account"; the SDK resolves `0` and `""`
 * as real user ids.
 *
 * Throwing is safe and expected to become `RESOLVER_ERROR` — never
 * `ACCOUNT_REQUIRED`, because a database that is down must not send a human off
 * to fix an account that is fine.
 */
const resolveAccount = (db: DatabaseService) => async ({ email }: { email: string }) => {
  const rows = await Effect.runPromise(
    db.all<{ id: string }>(
      "SELECT id FROM users WHERE email = ? ORDER BY created_at LIMIT 1",
      [normalizeEmail(email)]
    )
  );
  return rows[0]?.id ?? null;
};

/**
 * The per-user request budget, backed by a Cloudflare Rate Limiting binding so
 * the counters never touch D1 — a rate-limited agent should not add latency to
 * the reads that serve the dashboard.
 *
 * The key is the resolved user id, because the caller is only known after the
 * token verifies. Absent outside the Worker (local `next dev` has no binding),
 * which is the correct degradation: development should not require provisioned
 * infrastructure.
 */
interface RateLimiterBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

const rateLimiter = (): RateLimiterBinding | undefined => {
  const context = (
    globalThis as Record<PropertyKey, unknown>
  )[Symbol.for("__cloudflare-context__")] as
    | { env?: Record<string, unknown> }
    | undefined;

  const binding = context?.env?.AGENT_RATE_LIMITER as RateLimiterBinding | undefined;
  return binding && typeof binding.limit === "function" ? binding : undefined;
};

/**
 * Runs an Effect program as a verified agent.
 *
 * Mirrors `withAuth`: the program receives the caller's `userId` and returns a
 * NextResponse so routes control their own status codes. The differences are
 * all deliberate — the failure contract is `{ code, error }` for agents rather
 * than `{ error }` for humans, and internal error messages are never surfaced,
 * including in development, because a `DatabaseError` message carries SQL.
 *
 * This calls `verifyAgentToken` directly rather than the `@agentonboard/sdk/next`
 * binding. The binding withholds the `jti` on success, and `jti` is the field
 * to correlate an audit log on — so the status mapping below is written out by
 * hand, copied from the documented rule rather than defaulted.
 */
export async function withAgentAuth<A>(
  request: Request,
  program: (ctx: { userId: string }) => Effect.Effect<
    NextResponse,
    unknown,
    AppServices
  >
): Promise<NextResponse> {
  // `audience` is a literal we configure, never anything read off the request —
  // an audience the caller controls is not a check. `public/auth.md` is
  // generated from this same variable, so the published contract and the
  // verified one cannot disagree.
  const audience = process.env.AON_AUDIENCE?.trim();
  if (!audience) {
    console.error("[flowlist] agent auth rejected: CONFIG_ERROR");
    return fail(
      "CONFIG_ERROR",
      "This service has no AON_AUDIENCE configured.",
      500
    );
  }

  let db: DatabaseService;
  try {
    db = await getDatabase();
  } catch (e) {
    // Deliberately does not echo the cause to the caller: `getDatabase` throws
    // messages that name the account, the database id, and the credential
    // path. It is logged here, server-side, where those values are not
    // readable by an unauthenticated request.
    console.error("[flowlist] agent auth rejected: RESOLVER_ERROR", e);
    return fail(
      "RESOLVER_ERROR",
      "This service could not reach its database.",
      500
    );
  }

  // Pass the header value as-is; a leading `Bearer ` is stripped by the SDK.
  // The token is never logged, and never leaves this function except as the
  // argument the verifier needs.
  const verified = await verifyAgentToken({
    token: request.headers.get("Authorization") ?? "",
    audience,
  });

  if (!verified.ok) {
    // Log the code, and nothing else: never the token, the Authorization
    // header, or the email.
    console.warn(`[flowlist] agent auth rejected: ${verified.code}`);
    return fail(verified.code, verified.error, statusFor(verified.code));
  }

  // A resolver that throws must become RESOLVER_ERROR, never ACCOUNT_REQUIRED:
  // "my database is down" reported as "no account here" sends a human off to
  // fix an account that is fine. So the failure is tracked separately from the
  // value rather than collapsed into a null.
  let userId: string | null;
  try {
    userId = await resolveAccount(db)({ email: verified.email });
  } catch (e) {
    console.error("[flowlist] agent auth rejected: RESOLVER_ERROR", e);
    return fail(
      "RESOLVER_ERROR",
      "This service could not look up the account for this identity.",
      500
    );
  }

  if (userId === null || userId === undefined) {
    // 403, not 401. The token verified — the account does not exist, and
    // re-authenticating cannot create one. `location` points at the same
    // sign-up flow `auth.md` advertises.
    console.warn("[flowlist] agent auth rejected: ACCOUNT_REQUIRED");
    return fail(
      "ACCOUNT_REQUIRED",
      "This identity has no Flowlist account. Ask the human to sign up at " +
        `https://${audience}/sign-up, then retry once. Retrying without that will never succeed.`,
      403,
      { location: `https://${audience}/sign-up` }
    );
  }

  // Correlate on jti: the one field that identifies this token in an audit log.
  console.log(`[flowlist] agent request verified: ${verified.jti}`);

  const limiter = rateLimiter();
  if (limiter) {
    const { success } = await limiter.limit({ key: userId });
    if (!success) {
      return fail(
        "RATE_LIMITED",
        `Rate limit exceeded. At most ${RATE_LIMIT_PER_MINUTE} requests per minute are allowed per user.`,
        429
      );
    }
  }

  const layer = makeAppLayer(db);

  const effect = Effect.gen(function* () {
    return yield* program({ userId });
  }).pipe(
    Effect.catchIf(
      (e): e is TodoNotFoundError => e instanceof TodoNotFoundError,
      () => Effect.succeed(fail("NOT_FOUND", "To-do not found", 404))
    ),
    Effect.catchIf(
      (e): e is DatabaseError => e instanceof DatabaseError,
      (e) => {
        console.error("[flowlist] agent database error:", e.message, e.cause);
        return Effect.succeed(
          fail("INTERNAL_ERROR", "Internal server error", 500)
        );
      }
    )
  );

  const exit = await Effect.runPromiseExit(Effect.provide(effect, layer));

  if (Exit.isSuccess(exit)) return exit.value;

  console.error("[flowlist] agent unhandled failure:", Cause.pretty(exit.cause));
  return fail("INTERNAL_ERROR", "Internal server error", 500);
}
