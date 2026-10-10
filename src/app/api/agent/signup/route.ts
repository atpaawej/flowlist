import { NextResponse } from "next/server";
import { Effect } from "effect";
import { clerkClient } from "@clerk/nextjs/server";
import { createAgentAccount, normalizeEmail } from "@agentonboard/sdk";
import { getDatabase } from "@/lib/d1";
import { agentAudience, resolveAccount } from "@/lib/agent-auth";
import { DatabaseError } from "@/services/Database";
import type { DatabaseService } from "@/services/Database";

/**
 * The signup door: the one route in this app that can create an account.
 *
 * Everything else under `/api/agent/*` verifies and resolves, and an unknown
 * identity gets `403 ACCOUNT_REQUIRED` pointing here. An agent that reads
 * `/auth.md` calls this with the same token, then retries its original request
 * once. Nobody signs up twice, because `createAgentAccount` resolves before it
 * creates: a hit returns `created: false` and this handler never inserts.
 *
 * This is deliberate opt-in. AgentOnboard has no consent model, so *any* of its
 * users can present a genuine identity here whether or not they have heard of
 * Flowlist — which means this endpoint is stranger self-registration, the same
 * as the human sign-up form, with the same abuse surface. What makes it
 * intentional rather than incidental is that it is a separate import in a
 * separate file: "Flowlist lets agents create accounts" is one grep, and it
 * never runs as a side effect of some other request, including a read.
 *
 * The account is created in Clerk *and* in D1, in that order, with the Clerk
 * user id as the D1 primary key. So `users.id` means the same thing for every
 * account in this table — human or agent — and the human needs no merge step
 * to land in the account their agent already worked in: they sign in, Clerk
 * hands them the id their to-dos are already filed under, and `UserService.
 * ensure` finds the row waiting for them.
 */

/**
 * Creates the Clerk user and the D1 row that shares its id.
 *
 * **Verified, and that is the point.** Clerk marks an email created through
 * this method as verified *by default* — there is no flag to set, only
 * `emailAddressIdentificationStatus: 'reserved'` to opt out of it. Verified is
 * the status that makes the human's life work: when they later sign in with
 * Google on that address, Clerk links the OAuth account to this user and signs
 * them straight in, rather than refusing the sign-up because the email is
 * already taken. We are already trusting AgentOnboard's assertion that the inbox
 * is verified — that assertion is what the D1 row below is filed under — so
 * asserting it to Clerk as well extends no new trust, it stops keeping the same
 * verified fact in two places that disagree.
 *
 * `reserved` would be the wrong choice, and not because it is less verified: a
 * reserved identifier *cannot be claimed by another user*, so it squats the
 * address just as hard while also not linking on OAuth sign-in. It is strictly
 * the worse of the two.
 *
 * **No password, deliberately.** `skipPasswordRequirement` lets the account
 * exist before its owner can sign in. Never set one here: the whole safety of
 * this endpoint rests on there being no credential an agent could ever use to
 * authenticate as this human. No password means the agent can write to the
 * account and cannot log into it; the human gets in by proving they own the
 * inbox (OAuth, or Clerk's forgot-password, which sets the first one).
 *
 * **Ordering, and why it is the recoverable one.** Clerk is written before
 * D1 because D1 is the system of record for authorization — a Clerk user with
 * no D1 row is unreachable, while a D1 row whose Clerk user was never created
 * would authorize an id that cannot sign in. The cost is that a failure between
 * the two leaves an orphan Clerk user. That state self-heals: the agent retries,
 * `createUser` rejects the address as taken, `clerkIdFor` below looks it up, and
 * the D1 insert completes. The reverse order has no such retry.
 *
 * `ON CONFLICT DO NOTHING` with no conflict target, because now there are two
 * ways to collide rather than one: the UNIQUE index on `users.email` from
 * migration 0002, and the primary key when two agents race and both resolve to
 * the same Clerk user. Naming only the email would let the second raise on the
 * primary key. Either way the insert is skipped and the re-read below finds the
 * id that actually won — which is the id `resolveAccount` will return on every
 * later request, so the agent is never handed an id with no row behind it.
 */
const createAccount =
  (db: DatabaseService) =>
  async ({ email }: { email: string }): Promise<string> => {
    const normalized = normalizeEmail(email);
    const clerkId = await clerkIdFor(normalized);
    const now = new Date().toISOString();

    await Effect.runPromise(
      db.execute(
        `INSERT INTO users (id, email, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [clerkId, normalized, now, now]
      )
    );

    const rows = await Effect.runPromise(
      db.all<{ id: string }>("SELECT id FROM users WHERE email = ? LIMIT 1", [
        normalized,
      ])
    );

    // Unreachable in practice: the insert either lands or conflicts with a row
    // the resolver would have found. Throwing is still the right failure here —
    // it becomes RESOLVER_ERROR, which tells the agent to retry rather than
    // pointing it at an account that does not exist.
    const row = rows[0];
    if (!row) throw new DatabaseError("user row vanished after insert", null);
    return row.id;
  };

/**
 * The Clerk user id for a verified email, creating the user if there is none.
 *
 * Clerk rejects a duplicate address rather than returning the incumbent, so the
 * retry after an orphaned create has to be answered by a lookup. `getUserList`
 * is what answers it: it filters on an exact address and needs no query string
 * to be built, so a malformed address cannot widen the match.
 *
 * A lookup that comes back empty is a genuine fault rather than a reason to
 * create a second user — that would produce exactly the split identity this
 * endpoint exists to avoid — so it throws and becomes RESOLVER_ERROR.
 */
const clerkIdFor = async (email: string): Promise<string> => {
  const client = await clerkClient();
  const create = () =>
    client.users.createUser({
      emailAddress: [email],
      skipPasswordRequirement: true,
      publicMetadata: { createdBy: "agentonboard" },
    });

  try {
    return (await create()).id;
  } catch (e) {
    if (!isEmailTaken(e)) throw e;
  }

  const { data } = await client.users.getUserList({ emailAddress: [email] });
  const existing = data[0];
  if (!existing) {
    throw new Error(
      "Clerk reported the email as taken but returned no user for it"
    );
  }
  return existing.id;
};

/**
 * Whether a `createUser` failure means "that address already has a user".
 *
 * Clerk returns `IdentificationExists` / `email_address_exists` for it, and it
 * is a 4xx like a bad key or a rejected configuration — so this distinguishes a
 * reason to look the user up from a reason to give up, and nothing else in the
 * error is interpreted. Matching the code rather than the status is deliberate:
 * a 401 or a 403 must never be mistaken for "someone beat us to it".
 */
const isEmailTaken = (e: unknown): boolean => {
  const errors =
    typeof e === "object" && e !== null && "errors" in e
      ? (e as { errors?: unknown }).errors
      : undefined;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (err) =>
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "email_address_exists"
  );
};

export async function POST(request: Request) {
  const audience = agentAudience();
  if (!audience) {
    console.error("[flowlist] agent signup rejected: CONFIG_ERROR");
    return NextResponse.json(
      { code: "CONFIG_ERROR", error: "This service has no AON_AUDIENCE configured." },
      { status: 500 }
    );
  }

  let db: DatabaseService;
  try {
    db = await getDatabase();
  } catch (e) {
    // The cause names the account, database id, and credential path — logged
    // here, never returned.
    console.error("[flowlist] agent signup rejected: RESOLVER_ERROR", e);
    return NextResponse.json(
      { code: "RESOLVER_ERROR", error: "This service could not reach its database." },
      { status: 500 }
    );
  }

  // The token is verified first, inside createAgentAccount. Neither callback
  // runs for a forged or expired token — that ordering is the security property
  // the whole layer exists to provide, and it is why this handler never looks at
  // the email itself.
  const outcome = await createAgentAccount({
    token: request.headers.get("Authorization") ?? "",
    audience,
    resolveAccount: resolveAccount(db),
    createAccount: createAccount(db),
  });

  if (!outcome.ok) {
    // createAgentAccount never reports ACCOUNT_REQUIRED — a miss is what it is
    // for — so every code here is either a token fault (401) or ours (500).
    console.warn(`[flowlist] agent signup rejected: ${outcome.code}`);
    const serverFault = outcome.code === "RESOLVER_ERROR" || outcome.code === "CONFIG_ERROR";
    return NextResponse.json(
      { code: outcome.code, error: outcome.error },
      { status: serverFault ? 500 : 401 }
    );
  }

  // `created` is the field an audit log needs: it separates "signed in" from
  // "signed up", so an account created five minutes ago is distinguishable from
  // one the agent has been working in for months. Never log the token or email.
  console.log(
    `[flowlist] agent signup: created=${outcome.created} user=${outcome.user}`
  );

  return NextResponse.json(
    { created: outcome.created },
    // 201 when the account was just made, 200 when it already existed — the
    // split `auth.md` documents, so a retry is visibly a no-op rather than an
    // ambiguous success.
    { status: outcome.created ? 201 : 200 }
  );
}