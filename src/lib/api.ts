import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Cause, Effect, Exit } from "effect";
import { getDatabase } from "@/lib/d1";
import {
  makeAppLayer,
  TodoService,
  UserService,
  type AppServices,
} from "@/layers/AppLayer";
import { DatabaseError } from "@/services/Database";
import { TodoNotFoundError } from "@/services/TodoService";

/**
 * Resolves the user's email: prefers the JWT session claim (free), falling
 * back to a once-per-process Clerk lookup when the claim is absent.
 */
const emailCache = new Map<string, string | null>();

type SessionClaims = Awaited<ReturnType<typeof auth>>["sessionClaims"];

async function resolveEmail(
  userId: string,
  sessionClaims: SessionClaims | null
): Promise<string | null> {
  const claim = sessionClaims?.email;
  if (typeof claim === "string" && claim.length > 0) return claim;

  if (emailCache.has(userId)) return emailCache.get(userId) ?? null;
  try {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? null;
    emailCache.set(userId, email);
    return email;
  } catch {
    return null;
  }
}

/**
 * Runs an Effect program with full app services under an authenticated
 * context. Keeps the D1 `users` table in sync with Clerk on every request,
 * maps typed errors to HTTP responses, and logs anything unexpected.
 *
 * The program receives the authenticated `userId` and must return a
 * NextResponse (so routes control status codes such as 201).
 */
export async function withAuth<A>(
  program: (ctx: { userId: string }) => Effect.Effect<
    NextResponse,
    unknown,
    AppServices
  >
): Promise<NextResponse> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let db;
  try {
    db = await getDatabase();
  } catch (e) {
    console.error("[flowlist] database setup failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Database unavailable" },
      { status: 500 }
    );
  }

  const email = await resolveEmail(userId, sessionClaims);
  const layer = makeAppLayer(db);

  const effect = Effect.gen(function* () {
    const users = yield* UserService;
    yield* users.ensure(userId, email);
    return yield* program({ userId });
  }).pipe(
    Effect.catchIf(
      (e): e is TodoNotFoundError => e instanceof TodoNotFoundError,
      () =>
        Effect.succeed(
          NextResponse.json({ error: "To-do not found" }, { status: 404 })
        )
    ),
    Effect.catchIf(
      (e): e is DatabaseError => e instanceof DatabaseError,
      (e) => {
        console.error("[flowlist] database error:", e.message, e.cause);
        const message =
          process.env.NODE_ENV !== "production"
            ? e.message
            : "Internal server error";
        return Effect.succeed(
          NextResponse.json({ error: message }, { status: 500 })
        );
      }
    )
  );

  const exit = await Effect.runPromiseExit(Effect.provide(effect, layer));

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  console.error("[flowlist] unhandled failure:", Cause.pretty(exit.cause));
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}
