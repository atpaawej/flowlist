import { Context, Layer, type Effect } from "effect";

/**
 * Typed error for all database operations.
 */
export class DatabaseError {
  constructor(
    readonly message: string,
    readonly cause?: unknown
  ) {}
}

/**
 * The database contract used by every service. Two implementations exist:
 * - a native D1 binding driver (production, on Cloudflare Workers)
 * - a D1 REST API driver (local dev, talks to the real remote database)
 */
export interface DatabaseService {
  readonly all: <T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ) => Effect.Effect<T[], DatabaseError>;

  readonly execute: (
    sql: string,
    params?: readonly unknown[]
  ) => Effect.Effect<void, DatabaseError>;

  /**
   * Runs several statements as one unit.
   *
   * On D1 a batch *is* a transaction: a failing statement rolls the whole
   * sequence back. That is what makes it safe to move rows between two
   * `users.id` values — see the merge in `UserService.ensure`. Explicit
   * `BEGIN`/`COMMIT` are not used, and must not be: D1 rejects them.
   */
  readonly batch: (
    statements: readonly DbStatement[]
  ) => Effect.Effect<void, DatabaseError>;
}

/** One parameterised statement, as handed to {@link DatabaseService.batch}. */
export interface DbStatement {
  readonly sql: string;
  readonly params?: readonly unknown[];
}

/**
 * Effect v4 service key for the database.
 * Yield it inside `Effect.gen` to get the `DatabaseService`.
 */
export const Database = Context.Service<DatabaseService>("Database");

export const makeDatabaseLayer = (
  service: DatabaseService
): Layer.Layer<DatabaseService> => Layer.succeed(Database, service);
