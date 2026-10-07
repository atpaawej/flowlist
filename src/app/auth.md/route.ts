import { connection } from "next/server";
import { agentAudience } from "@/lib/agent-auth";

/**
 * The discovery file an agent reads to learn that Flowlist accepts AgentOnboard
 * and which hostname to mint a token for.
 *
 * Served from a route handler rather than `public/auth.md` for one reason:
 * `public/` is frozen at build time, so the same file would be right for one
 * environment and wrong for the other. The audience is read from the same
 * `AON_AUDIENCE` variable that verification uses, so the contract an agent reads
 * and the audience we verify against cannot drift apart — a mismatch between
 * them is the single most common cause of a 401 here.
 *
 * This file is also where the account-creation capability is published.
 * Whether an agent may create an account is not in the token and AgentOnboard
 * does not put it there — it is a partner-published fact, read by the agent like
 * everything else in this document. So the 403 row must name the signup endpoint,
 * and `POST /api/agent/signup` must actually exist; a table naming a flow this
 * service does not have is worse than no table.
 *
 * Nothing in the AgentOnboard toolchain reads this file. That is precisely why
 * the format has to be exact: the document is the contract, and no validator
 * exists to tell us it is wrong.
 */

/** The format is fixed by AgentOnboard: three sections, in this order, no front matter. */
const authMd = (audience: string) => `# Flowlist API

This service accepts AgentOnboard. Verified agent requests are authorized against the
Flowlist account that the verified email maps to, and read and write the same to-dos
as the human web app.

An agent can create an account for a human who does not have one yet, via
\`POST /api/agent/signup\`. The account belongs to the verified email and no other:
when that human later signs in at https://${audience}/sign-in, they see everything
the agent has already done.

Agent and human share one task list: changes made through this API appear immediately
in the dashboard.

## Audience

\`${audience}\`

    aon token get ${audience}

Send the token on every request as \`Authorization: Bearer <token>\`. Tokens live for five
minutes; mint a new one as needed.

## Endpoints

All eight endpoints require the header above. \`/api/agent/todos\` and \`/api/agent/tags\`
are rate limited to 120 requests per minute per user; \`429\` with \`RATE_LIMITED\` means
slow down and retry.

### \`POST /api/agent/signup\`

Create the calling account. An agent that got \`403 ACCOUNT_REQUIRED\` elsewhere calls this
with the same token, then retries its original request once — no human step in between.

This is the only endpoint that creates an account. It reads nothing from the request body:
the account's email comes from the verified token, so there is no way to register someone
else's address.

- Request: no body
- Success: \`201\` with \`{ "created": true }\` when the account was just made, or \`200\`
  with \`{ "created": false }\` when it already existed
- Calling it twice with the same token is safe and never creates a second account

The account is created with a generated id and no password. The human who owns it can sign
in at https://${audience}/sign-in with the same email at any time, and will find everything
the agent has already done.

### \`GET /api/agent/todos\`

List the calling account's to-dos. Never returns another account's to-dos.

- Query: \`status\` (\`active\` | \`completed\` | \`all\`), \`priority\` (\`low\` | \`medium\` | \`high\`),
  \`sortBy\` (\`custom\` | \`priority\` | \`dueDate\` | \`createdAt\`), \`tag\` (name), \`limit\`
  (default 50, max 200)
- Success: \`200\` with \`{ "todos": Array<{ "id", "title", "description", "dueDate", "priority", "completed", "tags" }> }\`

### \`POST /api/agent/todos\`

Create a to-do.

- Request: \`{ "title": string, "description"?: string, "dueDate"?: string | null, "priority"?: "low" | "medium" | "high", "tagNames"?: string[] }\`
- Success: \`201\` with \`{ "todo": { "id", "title", ... } }\`
- \`tagNames\` attaches existing tags by name; it does not create them.

### \`GET /api/agent/todos/{id}\`

Fetch one to-do with its tags.

- Success: \`200\` with \`{ "todo": { ... } }\`

### \`PATCH /api/agent/todos/{id}\`

Partially update a to-do. Omitted fields are left unchanged. Setting \`completed\` to
\`true\` marks it done.

- Request: any of \`title\`, \`description\`, \`dueDate\`, \`priority\`, \`completed\`, \`tagNames\`
- Success: \`200\` with \`{ "todo": { ... } }\`
- Passing \`tagNames\` replaces the to-do's tags with the named ones.

### \`DELETE /api/agent/todos/{id}\`

Delete a to-do. **This is permanent** — there is no undo, and the to-do cannot be
restored through this API. Prefer \`PATCH\` with \`completed: true\` when the goal is to
clear it rather than erase it.

- Success: \`200\` with \`{ "success": true }\`

### \`GET /api/agent/tags\`

List the calling account's tags, alphabetically.

- Success: \`200\` with \`{ "tags": Array<{ "id", "name", "createdAt" }> }\`

### \`POST /api/agent/tags\`

Create a tag. If a tag with that name already exists (case-insensitive) it is
returned as-is with \`200\` rather than duplicated, so this is safe to retry.

- Request: \`{ "name": string }\`
- Success: \`201\` with \`{ "tag": { "id", "name" } }\`

### \`DELETE /api/agent/tags/{id}\`

Delete a tag. **This is permanent.** The tag is removed from every to-do it was on;
the to-dos themselves are not deleted.

- Success: \`200\` with \`{ "success": true }\`

## When a request is rejected

| Status | \`code\` | What to do |
|---|---|---|
| 400 | \`INVALID_REQUEST\` | The body or query did not match the documented shape. Fix the request — retrying it unchanged will fail identically. |
| 401 | \`EXPIRED\`, \`INVALID_SIGNATURE\`, \`AUDIENCE_MISMATCH\`, \`ISSUER_MISMATCH\`, \`MALFORMED_TOKEN\`, \`UNKNOWN_KEY\`, \`KEY_SOURCE_UNAVAILABLE\`, \`MISSING_EMAIL\` | The token was rejected. Run \`aon token get ${audience}\` again and retry **once**. If it fails again, stop and tell the human — do not retry in a loop. |
| 403 | \`ACCOUNT_REQUIRED\` | The identity is genuine but has no Flowlist account. Create one at \`POST /api/agent/signup\` with the same token, then retry the original request **once**. **Retrying without that will never succeed.** |
| 404 | \`NOT_FOUND\` | No such to-do on this account. Do not retry with the same id. |
| 429 | \`RATE_LIMITED\` | Over 120 requests per minute for this user. Wait and retry after a delay. |
| 500 | \`RESOLVER_ERROR\`, \`CONFIG_ERROR\`, \`INTERNAL_ERROR\` | A fault on Flowlist's side, not yours. Retry after a short delay. Do not re-authenticate — the token is fine. |

Every error body is \`{ "code": "...", "error": "..." }\`. Branch on \`code\`, which is
stable; \`error\` is one sentence written for a human and is not machine-readable.
`;

export async function GET() {
  // Read the environment at request time rather than baking it into the build,
  // so the same source serves the dev audience and the production one.
  await connection();

  const audience = agentAudience();
  if (!audience) {
    return new Response(
      "# Flowlist API\n\nThis deployment has no agent audience configured.\n",
      { status: 500, headers: { "content-type": "text/markdown; charset=utf-8" } }
    );
  }

  return new Response(authMd(audience), {
    // Read by an agent before it has a token, so caching it would be wrong.
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
