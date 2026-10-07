import { NextResponse } from "next/server";
import { Effect } from "effect";
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
 * The account is created in D1 only, with a generated id — no Clerk user. So
 * the human cannot sign in to it yet; what happens when they do is the merge in
 * `UserService.ensure`, which folds these rows into their Clerk id on first
 * authenticated request.
 */

/**
 * Creates the row for a verified identity.
 *
 * The id is generated here and is NOT a Clerk user id — nothing about it means
 * anything to Clerk, which is exactly why the merge on first sign-in exists.
 *
 * `ON CONFLICT(email) DO NOTHING` relies on the UNIQUE index from migration
 * 0002. Without it this is a read-then-write race: two agents registering the
 * same human at once would both miss the resolver and both insert, leaving two
 * accounts where there should be one. With it, the loser of the race inserts
 * nothing — and because the insert is skipped, this must re-read to find out
 * which id actually won, otherwise the agent would be handed an id with no row
 * behind it and every subsequent request would 403.
 */
const createAccount =
  (db: DatabaseService) =>
  async ({ email }: { email: string }): Promise<string> => {
    const normalized = normalizeEmail(email);
    const candidate = crypto.randomUUID();
    const now = new Date().toISOString();

    await Effect.runPromise(
      db.execute(
        `INSERT INTO users (id, email, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO NOTHING`,
        [candidate, normalized, now, now]
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